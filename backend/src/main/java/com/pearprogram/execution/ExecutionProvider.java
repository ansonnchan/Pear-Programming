package com.pearprogram.execution;

public interface ExecutionProvider {
    String submit(ProviderExecutionRequest request);

    ProviderExecutionResult getResult(String submissionToken);

    /**
     * Whether this provider can run the given application language id (for example "kotlin").
     */
    default boolean supportsLanguage(String language) {
        return true;
    }
}
