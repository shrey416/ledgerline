package com.ledgerline.finance;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.ResponseEntity;

/** Private finance workbench. Identity is always derived from the verified bearer token. */
@RestController
@RequestMapping("/api/v1/core/me")
public class WorkbenchController {
    private final JdbcTemplate db;
    private final ObjectMapper json;
    public WorkbenchController(JdbcTemplate db, ObjectMapper json) { this.db=db; this.json=json; }
    public record Save(long revision, UUID requestId, JsonNode workspaces) {}
    private static final String EMPTY="""
        [{"id":"personal","name":"Personal workspace","type":"personal","currency":"INR","opening":{"Main account":"0","Credit card":"0","Cash":"0"},"transactions":[],"commitments":[],"budgets":[]},
         {"id":"business","name":"Business workspace","type":"business","currency":"INR","opening":{"Main account":"0","Credit card":"0","Cash":"0"},"transactions":[],"commitments":[],"budgets":[]}]
        """;
    private void ensure(String subject) {
        db.update("INSERT INTO user_workbench(oidc_subject,document) VALUES(?,?::jsonb) ON CONFLICT DO NOTHING",subject,EMPTY);
    }
    private Map<String,Object> snapshot(String subject) {
        var row=db.queryForMap("SELECT document::text,revision,updated_at FROM user_workbench WHERE oidc_subject=?",subject);
        try { return Map.of("workspaces",json.readTree((String)row.get("document")),"revision",row.get("revision"),"updatedAt",((java.sql.Timestamp)row.get("updated_at")).toInstant().toString()); }
        catch(Exception e) { throw new IllegalStateException("Stored workbench cannot be decoded",e); }
    }
    @GetMapping("/workbench") @Transactional
    public Map<String,Object> get(@AuthenticationPrincipal Jwt jwt) { ensure(jwt.getSubject()); return snapshot(jwt.getSubject()); }
    @PutMapping("/workbench") @Transactional
    public Map<String,Object> save(@AuthenticationPrincipal Jwt jwt,@RequestBody Save command) {
        if(command.requestId()==null || command.revision()<0) invalid("A revision and request ID are required.");
        validate(command.workspaces());
        String subject=jwt.getSubject(); ensure(subject);
        var prior=db.queryForMap("SELECT document::text,revision FROM user_workbench WHERE oidc_subject=? FOR UPDATE",subject);
        var existing=db.queryForList("SELECT revision FROM workbench_change WHERE oidc_subject=? AND request_id=?",Long.class,subject,command.requestId());
        if(!existing.isEmpty()) {
            // Replays never reapply an older command or silently accept a different payload.
            if(((Number)prior.get("revision")).longValue()!=existing.getFirst() || !decode((String)prior.get("document")).equals(command.workspaces()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"This request was already applied. Refresh your account data.");
            return snapshot(subject);
        }
        if(((Number)prior.get("revision")).longValue()!=command.revision())
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Another tab changed your account. Refresh before saving again.");
        long next=command.revision()+1;
        db.update("INSERT INTO workbench_change(id,oidc_subject,revision,request_id,prior_document) VALUES(?,?,?,?,?::jsonb)",UUID.randomUUID(),subject,next,command.requestId(),prior.get("document"));
        db.update("UPDATE user_workbench SET document=?::jsonb,revision=?,updated_at=now() WHERE oidc_subject=?",command.workspaces().toString(),next,subject);
        UUID event=UUID.randomUUID();
        // No recipient addresses or finance documents leave the owning database through this event.
        db.update("INSERT INTO outbox_event(id,aggregatetype,aggregateid,type,payload) VALUES(?,?,?, ?,jsonb_build_object('eventId',?::text,'eventType','finance.workbench.updated','schemaVersion',1,'aggregateVersion',?::bigint))",event,"workbench",subject,"finance.workbench.updated",event.toString(),next);
        return snapshot(subject);
    }
    @GetMapping("/history") public List<Map<String,Object>> history(@AuthenticationPrincipal Jwt jwt) {
        return db.queryForList("SELECT revision,created_at FROM workbench_change WHERE oidc_subject=? ORDER BY revision DESC LIMIT 50",jwt.getSubject());
    }
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String,String>> invalidResponse(ResponseStatusException error) {
        return ResponseEntity.status(error.getStatusCode()).body(Map.of("message",Objects.requireNonNullElse(error.getReason(),"Request rejected.")));
    }
    private JsonNode decode(String value) { try{return json.readTree(value);}catch(Exception e){throw new IllegalStateException(e);} }
    private static void invalid(String message) { throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,message); }
    private static String text(JsonNode item,String field,int max) {
        JsonNode value=item.get(field);
        if(value==null || !value.isTextual() || value.textValue().isBlank() || value.textValue().length()>max) invalid("Invalid "+field+".");
        return value.textValue();
    }
    private static void oneOf(String value,String... choices) {if(!Arrays.asList(choices).contains(value))invalid("Unsupported value: "+value);}
    private static void amount(JsonNode value,boolean signed) {
        if(value==null || !value.isTextual() || !value.textValue().matches(signed?"-?[0-9]{1,9}(\\.[0-9]{1,2})?":"[0-9]{1,9}(\\.[0-9]{1,2})?")) invalid("Use decimal amounts with at most two places.");
        BigDecimal number=new BigDecimal(value.textValue());
        if(!signed && number.signum()<=0 || number.abs().compareTo(new BigDecimal("999999999.99"))>0) invalid("Amount out of range.");
    }
    private static void date(JsonNode item,String key) {
        String value=text(item,key,10);
        try{if(!value.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}") || LocalDate.parse(value).getYear()<1900 || LocalDate.parse(value).getYear()>2200)invalid("Date out of range.");}
        catch(java.time.DateTimeException e){invalid("Invalid calendar date.");}
    }
    private static JsonNode array(JsonNode item,String key,int max) {
        JsonNode value=item.get(key);if(value==null || !value.isArray() || value.size()>max)invalid("Invalid "+key+" collection.");return value;
    }
    static void validate(JsonNode documents) {
        if(documents==null || !documents.isArray() || documents.size()!=2 || documents.toString().length()>2_000_000)invalid("Expected two bounded private workspaces.");
        Set<String> workspaces=new HashSet<>();
        for(JsonNode w:documents) {
            String id=text(w,"id",20);oneOf(id,"personal","business");
            if(!workspaces.add(id) || !text(w,"type",20).equals(id))invalid("Invalid workspace identity.");
            text(w,"name",80);oneOf(text(w,"currency",3),"INR");
            JsonNode opening=w.get("opening");if(opening==null || !opening.isObject() || opening.size()<1 || opening.size()>30)invalid("Choose 1–30 accounts.");
            Set<String> accountNames=new HashSet<>();
            opening.fields().forEachRemaining(entry->{if(entry.getKey().isBlank() || entry.getKey().length()>80 || !entry.getKey().equals(entry.getKey().trim()) || entry.getKey().equals("__proto__") || entry.getKey().equals("constructor") || entry.getKey().equals("prototype"))invalid("Invalid account name.");amount(entry.getValue(),true);accountNames.add(entry.getKey());});
            if(!accountNames.contains("Main account"))invalid("The default payment account must be retained.");
            Set<String> transactionIds=new HashSet<>();
            Map<String,JsonNode> transactionById=new HashMap<>();
            for(JsonNode t:array(w,"transactions",10000)) {
                if(!transactionIds.add(text(t,"id",160)))invalid("Duplicate transaction.");
                transactionById.put(t.get("id").textValue(),t);
                String kind=text(t,"kind",20);oneOf(kind,"expense","income","transfer");text(t,"merchant",120);amount(t.get("amount"),false);date(t,"date");
                String source=text(t,"account",80);if(!accountNames.contains(source))invalid("Unknown funding account.");
                if(kind.equals("transfer")){String dest=text(t,"destination",80);if(dest.equals(source) || !accountNames.contains(dest))invalid("Choose a different destination account.");}
                text(t,"category",80);
                if(!t.path("note").isTextual() || t.path("note").textValue().length()>1000 || !t.path("reviewed").isBoolean())invalid("Invalid transaction note or review state.");
            }
            Set<String> commitments=new HashSet<>();
            Set<String> linkedPayments=new HashSet<>();
            int openCommitments=0;
            for(JsonNode c:array(w,"commitments",1000)) {
                if(!commitments.add(text(c,"id",160)))invalid("Duplicate commitment.");text(c,"name",120);amount(c.get("amount"),false);date(c,"due");text(c,"category",80);
                oneOf(text(c,"kind",20),"bill","subscription");oneOf(text(c,"cadence",20),"Once","Monthly","Yearly");String state=text(c,"state",20);oneOf(state,"open","paid","canceled");
                if(state.equals("open") && ++openCommitments>100)invalid("Keep at most 100 active commitments per workspace.");
                if(state.equals("paid")) {
                    String paymentId=text(c,"paidTransactionId",160);
                    JsonNode payment=transactionById.get(paymentId);
                    if(payment==null || !linkedPayments.add(paymentId) || !payment.path("kind").asText().equals("expense") || new BigDecimal(payment.path("amount").asText()).compareTo(new BigDecimal(c.path("amount").asText()))!=0)
                        invalid("A paid commitment must retain a unique matching expense payment.");
                }
            }
            Set<String> budgets=new HashSet<>();
            for(JsonNode b:array(w,"budgets",50)){if(!budgets.add(text(b,"category",80)))invalid("Duplicate budget category.");amount(b.get("amount"),false);}
        }
    }
}
