package com.pearprogram.execution;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ExecutionLanguageControllerTests {
    @Test
    void returnsTheRegistryCatalog() {
        ExecutionLanguageRegistry registry = new ExecutionLanguageRegistry();
        ExecutionProvider allLanguages = new ExecutionProvider() {
            @Override public String submit(ProviderExecutionRequest request) { return "token"; }
            @Override public ProviderExecutionResult getResult(String token) { return null; }
        };
        assertThat(new ExecutionLanguageController(registry, allLanguages).list()).isEqualTo(registry.options());

        ExecutionProvider noKotlin = new ExecutionProvider() {
            @Override public String submit(ProviderExecutionRequest request) { return "token"; }
            @Override public ProviderExecutionResult getResult(String token) { return null; }
            @Override public boolean supportsLanguage(String language) { return !"kotlin".equals(language); }
        };
        assertThat(new ExecutionLanguageController(registry, noKotlin).list())
                .extracting(ExecutionLanguageOption::id)
                .hasSize(registry.options().size() - 1)
                .doesNotContain("kotlin");
    }
}
