package com.ledgerline.finance;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration
class Telemetry {
    @Bean FilterRegistrationBean<OncePerRequestFilter> requestMetrics(MeterRegistry registry,JdbcTemplate db) {
        Gauge.builder("ledgerline.dependency.up",db,sql->{try {sql.queryForObject("SELECT 1",Integer.class);return 1;}catch(Exception error){return 0;}})
            .tag("service","core-finance").tag("dependency","postgresql").register(registry);
        Gauge.builder("ledgerline.outbox.rows",db,sql->{try{return sql.queryForObject("SELECT COUNT(*) FROM outbox_event",Long.class);}catch(Exception error){return 0;}}).tag("service","core-finance").register(registry);
        OncePerRequestFilter filter=new OncePerRequestFilter() {
            protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
                String path=request.getRequestURI();
                if(path.equals("/actuator/prometheus")){chain.doFilter(request,response);return;}
                String route=path.matches("/actuator/health(/readiness|/liveness)?")?path:path.matches("/api/v1/core/workspaces/[^/]+/(accounts|transactions)")?path.replaceAll("/workspaces/[^/]+","/workspaces/:id"):"other";
                Timer.Sample sample=Timer.start(registry);
                try{chain.doFilter(request,response);}finally{
                    String status=String.valueOf(response.getStatus());
                    Counter.builder("ledgerline.http.requests").tags("service","core-finance","method",request.getMethod(),"route",route,"status",status).register(registry).increment();
                    sample.stop(Timer.builder("ledgerline.http.request.duration").tags("service","core-finance","method",request.getMethod(),"route",route,"status",status).publishPercentileHistogram().register(registry));
                }
            }
        };
        FilterRegistrationBean<OncePerRequestFilter> registration=new FilterRegistrationBean<>(filter);
        registration.setOrder(Integer.MIN_VALUE);return registration;
    }
}
