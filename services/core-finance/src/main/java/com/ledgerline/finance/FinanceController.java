package com.ledgerline.finance;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/core/workspaces/{workspaceId}")
public class FinanceController {
    private final JdbcTemplate db;
    public FinanceController(JdbcTemplate db) { this.db = db; }
    public record Entry(@NotBlank @Pattern(regexp="expense|income|transfer") String kind,
        @NotBlank @Size(max=120) String merchant, @NotBlank @Pattern(regexp="[0-9]+(\\.[0-9]{1,2})?") String amount,
        @NotNull LocalDate effectiveDate, @NotNull UUID accountId, UUID destinationAccountId,
        @NotBlank @Size(max=80) String category, @Size(max=1000) String note) {}

    private void authorize(UUID workspaceId, String subject, boolean write) {
        var roles = db.queryForList("SELECT role FROM membership WHERE workspace_id=? AND oidc_subject=?",String.class,workspaceId,subject);
        if(roles.isEmpty() || write && !List.of("owner","finance").contains(roles.getFirst()))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Workspace capability denied");
    }
    @GetMapping("/accounts") public List<Map<String,Object>> accounts(@PathVariable UUID workspaceId,@AuthenticationPrincipal Jwt jwt) {
        authorize(workspaceId,jwt.getSubject(),false);
        return db.queryForList("SELECT a.id,a.name,a.currency,a.kind,COALESCE(SUM(l.signed_amount),0)::text AS balance FROM finance_account a LEFT JOIN journal_line l ON a.id=l.account_id AND a.workspace_id=l.workspace_id WHERE a.workspace_id=? AND a.kind IN ('asset','liability') GROUP BY a.id ORDER BY a.name",workspaceId);
    }
    @GetMapping("/transactions") public List<Map<String,Object>> transactions(@PathVariable UUID workspaceId,@AuthenticationPrincipal Jwt jwt,
            @RequestParam(defaultValue="50") int limit,@RequestParam(required=false) UUID before) {
        authorize(workspaceId,jwt.getSubject(),false);
        if(limit<1||limit>200)throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"Limit must be 1–200");
        // Stable keyset pagination ordered by immutable ID; date sorting is added in Phase 2.
        return before==null ? db.queryForList("SELECT id,kind,merchant,amount::text,currency,effective_date,category,note FROM journal_transaction WHERE workspace_id=? ORDER BY id DESC LIMIT ?",workspaceId,limit)
            : db.queryForList("SELECT id,kind,merchant,amount::text,currency,effective_date,category,note FROM journal_transaction WHERE workspace_id=? AND id<? ORDER BY id DESC LIMIT ?",workspaceId,before,limit);
    }
    @PostMapping("/transactions") @Transactional public Map<String,Object> post(@PathVariable UUID workspaceId,@AuthenticationPrincipal Jwt jwt,
            @RequestHeader("Idempotency-Key") @Size(min=8,max=128) String key,@Valid @RequestBody Entry entry) {
        var roles=db.queryForList("SELECT role FROM membership WHERE workspace_id=? AND oidc_subject=? FOR SHARE",String.class,workspaceId,jwt.getSubject());
        if(roles.isEmpty()||!List.of("owner","finance").contains(roles.getFirst()))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Workspace capability denied");
        if(key.length()<8||key.length()>128)throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"Invalid idempotency key");
        BigDecimal amount = new BigDecimal(entry.amount());
        if(amount.signum()<=0||amount.compareTo(new BigDecimal("999999999.99"))>0)throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"Amount out of bounds");
        // Revocation serializes against the membership lock held for this entire command.
        String payload = entry.toString();
        UUID id=UUID.randomUUID();
        int inserted=db.update("INSERT INTO command_result(workspace_id,actor,key,payload,result_id) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING",workspaceId,jwt.getSubject(),key,payload,id);
        if(inserted==0) {
            Map<String,Object> prior=db.queryForMap("SELECT payload,result_id FROM command_result WHERE workspace_id=? AND actor=? AND key=?",workspaceId,jwt.getSubject(),key);
            if(!payload.equals(prior.get("payload")))throw new ResponseStatusException(HttpStatus.CONFLICT,"Key reused with a different request");
            return Map.of("id",prior.get("result_id"),"replayed",true);
        }
        // Stable account lock order avoids opposing transfers deadlocking on their two funding rows.
        if(entry.kind().equals("transfer")&&entry.destinationAccountId()!=null)
            db.queryForList("SELECT id FROM finance_account WHERE workspace_id=? AND id IN (?,?) ORDER BY id FOR UPDATE",workspaceId,entry.accountId(),entry.destinationAccountId());
        var source=db.queryForList("SELECT currency FROM finance_account WHERE id=? AND workspace_id=? AND kind IN ('asset','liability') AND archived=false FOR UPDATE",String.class,entry.accountId(),workspaceId);
        if(source.isEmpty())throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"Invalid funding account");
        UUID counterparty;
        if(entry.kind().equals("transfer")) {
            if(entry.destinationAccountId()==null||entry.destinationAccountId().equals(entry.accountId()))throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"Choose another destination");
            var destination=db.queryForList("SELECT currency FROM finance_account WHERE id=? AND workspace_id=? AND kind IN ('asset','liability') AND archived=false FOR UPDATE",String.class,entry.destinationAccountId(),workspaceId);
            if(destination.isEmpty()||!destination.getFirst().equals(source.getFirst()))throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"Only same-currency transfers supported in this increment");
            counterparty=entry.destinationAccountId();
        } else {
            var targets=db.queryForList("SELECT id FROM finance_account WHERE workspace_id=? AND kind=? AND currency=? AND archived=false",UUID.class,workspaceId,entry.kind(),source.getFirst());
            if(targets.size()!=1)throw new ResponseStatusException(HttpStatus.CONFLICT,"Workspace posting accounts not configured");
            counterparty=targets.getFirst();
        }
        db.update("INSERT INTO journal_transaction(id,workspace_id,actor,kind,merchant,amount,currency,effective_date,category,note) VALUES(?,?,?,?,?,?,?,?,?,?)",id,workspaceId,jwt.getSubject(),entry.kind(),entry.merchant(),amount,source.getFirst(),entry.effectiveDate(),entry.category(),entry.note());
        BigDecimal sourceAmount=entry.kind().equals("income")?amount:amount.negate();
        db.update("INSERT INTO journal_line(workspace_id,transaction_id,account_id,signed_amount) VALUES(?,?,?,?),(?,?,?,?)",workspaceId,id,entry.accountId(),sourceAmount,workspaceId,id,counterparty,sourceAmount.negate());
        UUID eventId=UUID.randomUUID();
        db.update("INSERT INTO outbox_event(id,aggregatetype,aggregateid,type,payload) VALUES(?,?,?,?,jsonb_build_object('eventId',?::text,'workspaceId',?::text,'aggregateId',?::text,'aggregateVersion',1,'eventType','finance.transaction.posted','schemaVersion',1,'data',jsonb_build_object('kind',?::text,'amount',?::text,'currency',?::text)))",eventId,"transaction",id.toString(),"finance.transaction.posted",eventId.toString(),workspaceId.toString(),id.toString(),entry.kind(),amount.toPlainString(),source.getFirst());
        return Map.of("id",id,"replayed",false);
    }
}
