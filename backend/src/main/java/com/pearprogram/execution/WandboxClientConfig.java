package com.pearprogram.execution;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

@Configuration
@ConditionalOnProperty(prefix = "pearprogram.execution", name = "provider", havingValue = "wandbox", matchIfMissing = true)
public class WandboxClientConfig {
    @Bean
    @Qualifier("wandboxRestClient")
    RestClient wandboxRestClient(ExecutionProperties properties) {
        ExecutionProperties.Wandbox settings = properties.getWandbox();
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(settings.getConnectTimeout());
        requestFactory.setReadTimeout(settings.getRequestTimeout());
        String baseUrl = settings.getBaseUrl() == null ? "" : settings.getBaseUrl().trim().replaceAll("/+$", "");
        return RestClient.builder()
                .baseUrl(baseUrl.isBlank() ? "https://wandbox.org" : baseUrl)
                .requestFactory(requestFactory)
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .build();
    }
}
