package com.pearprogram.execution;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatusCode;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.net.SocketTimeoutException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Predicate;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * Runs code on the free public Wandbox service (https://wandbox.org).
 *
 * <p>Wandbox executes synchronously: one HTTP call compiles and runs the program and returns its output.
 * To fit the poll-based {@link ExecutionProvider} contract, {@link #submit} performs the run and keeps the
 * result in memory under a generated token, and {@link #getResult} returns it. If a worker crashes between
 * the two calls, the recovered job reads a missing token and is finalized as failed rather than re-run.</p>
 */
@Component
@ConditionalOnProperty(prefix = "pearprogram.execution", name = "provider", havingValue = "wandbox", matchIfMissing = true)
public class WandboxExecutionProvider implements ExecutionProvider {
    private static final Logger log = LoggerFactory.getLogger(WandboxExecutionProvider.class);
    private static final String TOKEN_PREFIX = "wandbox-";
    private static final Pattern PUBLIC_MAIN_CLASS = Pattern.compile("(?m)^(\\s*)public\\s+((?:final\\s+)?class\\s+Main\\b)");
    // Kotlin has no Wandbox compiler. Swift fails to start on Wandbox (checked 2026-11-20), and its
    // .NET 8 image cannot create projects, so C# uses Mono. Re-check with WandboxLiveCheckTests.
    private static final Map<String, CompilerChoice> COMPILERS = Map.ofEntries(
            Map.entry("java", new CompilerChoice("Java", "openjdk")),
            Map.entry("python", new CompilerChoice("Python", "cpython-3")),
            Map.entry("javascript", new CompilerChoice("JavaScript", "nodejs")),
            Map.entry("c", new CompilerChoice("C", "gcc-")),
            Map.entry("cpp", new CompilerChoice("C++", "gcc-")),
            Map.entry("typescript", new CompilerChoice("TypeScript", "typescript")),
            Map.entry("sql", new CompilerChoice("SQL", "sqlite")),
            Map.entry("csharp", new CompilerChoice("C#", "mono")),
            Map.entry("php", new CompilerChoice("PHP", "php")),
            Map.entry("ruby", new CompilerChoice("Ruby", "ruby")),
            Map.entry("go", new CompilerChoice("Go", "go")),
            Map.entry("rust", new CompilerChoice("Rust", "rust")),
            Map.entry("r", new CompilerChoice("R", "r-")),
            Map.entry("shell", new CompilerChoice("Bash script", "bash"))
    );

    private final RestClient restClient;
    private final ObjectMapper objectMapper;
    private final ExecutionLanguageRegistry languages;
    private final ExecutionProperties.Wandbox settings;
    private final Map<String, StoredResult> results = new ConcurrentHashMap<>();
    private volatile CompilerCatalog catalog;

    public WandboxExecutionProvider(
            @Qualifier("wandboxRestClient") RestClient restClient,
            ObjectMapper objectMapper,
            ExecutionLanguageRegistry languages,
            ExecutionProperties properties
    ) {
        this.restClient = restClient;
        this.objectMapper = objectMapper;
        this.languages = languages;
        this.settings = properties.getWandbox();
    }

    @Override
    public boolean supportsLanguage(String language) {
        return COMPILERS.containsKey(languages.normalize(language));
    }

    @Override
    public String submit(ProviderExecutionRequest request) {
        String language = languages.languageForJudge0Id(request.languageId())
                .filter(this::supportsLanguage)
                .orElseThrow(() -> new ExecutionProviderException("Wandbox does not support this language", false));
        String compiler = compilerFor(language);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("compiler", compiler);
        body.put("code", "java".equals(language) ? withPackagePrivateMain(request.sourceCode()) : request.sourceCode());
        body.put("stdin", request.stdin() == null ? "" : request.stdin());

        ProviderExecutionResult result;
        try {
            String raw = withTransientRetry("compile", () -> restClient.post()
                    .uri("/api/compile.json")
                    .body(body)
                    .retrieve()
                    .body(String.class));
            result = normalize(objectMapper.readTree(raw == null ? "{}" : raw));
        } catch (ExecutionTimedOut timeout) {
            result = new ProviderExecutionResult(ExecutionStatus.TIMED_OUT, null, null, null, null, null,
                    "Execution exceeded the time limit.");
        } catch (ExecutionProviderException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new ExecutionProviderException("Execution provider returned a malformed response", false, exception);
        }

        String token = TOKEN_PREFIX + UUID.randomUUID();
        results.put(token, new StoredResult(result, Instant.now().plus(java.time.Duration.ofMinutes(15))));
        return token;
    }

    @Override
    public ProviderExecutionResult getResult(String submissionToken) {
        StoredResult stored = submissionToken == null ? null : results.remove(submissionToken);
        if (stored == null) {
            return new ProviderExecutionResult(ExecutionStatus.FAILED, null, null, null, null, null,
                    "The run result was lost before it could be read. Run the code again.");
        }
        return stored.result();
    }

    ProviderExecutionResult normalize(JsonNode root) {
        if (!root.hasNonNull("status")) {
            throw new ExecutionProviderException("Execution provider returned a malformed response", false);
        }
        Integer exitCode = parseExitCode(root.path("status").asText(""));
        String signal = text(root, "signal");
        String compilerOutput = text(root, "compiler_output");
        String compilerError = text(root, "compiler_error");
        String stdout = text(root, "program_output");
        String stderr = text(root, "program_error");

        ExecutionStatus status;
        String message = null;
        if (exitCode != null && exitCode == 0 && signal == null) {
            status = ExecutionStatus.COMPLETED;
        } else if (signal != null || (exitCode != null && exitCode == 137)) {
            status = ExecutionStatus.TIMED_OUT;
            message = "The program was stopped after exceeding the sandbox time or memory limit.";
        } else if (compilerError != null && stdout == null && stderr == null) {
            status = ExecutionStatus.COMPILATION_ERROR;
        } else {
            status = ExecutionStatus.RUNTIME_ERROR;
        }
        String compileOutput = join(compilerOutput, compilerError);
        return new ProviderExecutionResult(status, stdout, stderr, compileOutput, exitCode, null, message);
    }

    /**
     * Wandbox stores Java source as prog.java, where a public class named Main cannot compile.
     */
    static String withPackagePrivateMain(String source) {
        return source == null ? "" : PUBLIC_MAIN_CLASS.matcher(source).replaceAll("$1$2");
    }

    String compilerFor(String language) {
        CompilerChoice choice = COMPILERS.get(language);
        CompilerCatalog cached = catalog;
        CompilerCatalog current = cached == null || cached.expiresAt().isBefore(Instant.now()) ? loadCatalog() : cached;
        return current.compilers().stream()
                .filter(compiler -> compiler.language().equals(choice.wandboxLanguage()))
                .filter(compiler -> !compiler.name().contains("head"))
                .map(WandboxCompiler::name)
                .filter(name -> name.startsWith(choice.preferredPrefix()))
                .findFirst()
                .or(() -> firstStable(current, choice.wandboxLanguage()))
                .orElseThrow(() -> new ExecutionProviderException("Wandbox has no compiler for " + language, false));
    }

    @Scheduled(fixedDelay = 60_000)
    void evictExpiredResults() {
        Instant now = Instant.now();
        results.entrySet().removeIf(entry -> entry.getValue().expiresAt().isBefore(now));
    }

    private Optional<String> firstStable(CompilerCatalog current, String wandboxLanguage) {
        return current.compilers().stream()
                .filter(compiler -> compiler.language().equals(wandboxLanguage))
                .map(WandboxCompiler::name)
                .filter(Predicate.not(name -> name.contains("head")))
                .findFirst();
    }

    private synchronized CompilerCatalog loadCatalog() {
        CompilerCatalog current = catalog;
        if (current != null && current.expiresAt().isAfter(Instant.now())) {
            return current;
        }
        String raw = withTransientRetry("compiler list", () -> restClient.get()
                .uri("/api/list.json")
                .retrieve()
                .body(String.class));
        try {
            List<WandboxCompiler> compilers = new ArrayList<>();
            for (JsonNode node : objectMapper.readTree(raw == null ? "[]" : raw)) {
                compilers.add(new WandboxCompiler(node.path("name").asText(""), node.path("language").asText("")));
            }
            if (compilers.isEmpty()) {
                throw new ExecutionProviderException("Wandbox returned an empty compiler list", true);
            }
            catalog = new CompilerCatalog(List.copyOf(compilers), Instant.now().plus(settings.getCompilerCacheTtl()));
            return catalog;
        } catch (ExecutionProviderException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new ExecutionProviderException("Wandbox returned a malformed compiler list", true, exception);
        }
    }

    private <T> T withTransientRetry(String operation, Supplier<T> request) {
        int maxAttempts = Math.max(1, settings.getMaxRetries() + 1);
        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return request.get();
            } catch (RestClientResponseException exception) {
                int status = exception.getStatusCode().value();
                String body = Judge0ExecutionProvider.snippet(exception.getResponseBodyAsString());
                if (body.contains("Unknown compiler")) {
                    catalog = null;
                    log.warn("Wandbox rejected the selected compiler; the compiler list will be reloaded. body={}", body);
                    throw new ExecutionProviderException("Execution provider rejected the compiler", true, exception);
                }
                boolean transientFailure = isTransient(exception.getStatusCode());
                if (!transientFailure || attempt == maxAttempts) {
                    log.warn("Wandbox {} request failed. status={} body={}", operation, status, body);
                    throw new ExecutionProviderException("Execution provider request failed with HTTP " + status,
                            transientFailure, exception);
                }
            } catch (ResourceAccessException exception) {
                if (exception.getCause() instanceof SocketTimeoutException && "compile".equals(operation)) {
                    // The program ran past the read timeout; retrying would run it again.
                    throw new ExecutionTimedOut();
                }
                if (attempt == maxAttempts) {
                    log.warn("Wandbox {} request could not reach the provider. reason={}", operation, exception.getMessage());
                    throw new ExecutionProviderException("Execution provider is unavailable", true, exception);
                }
            } catch (RestClientException exception) {
                if (attempt == maxAttempts) {
                    throw new ExecutionProviderException("Execution provider is unavailable", true, exception);
                }
            }
            sleep(Math.min(8_000L, Math.max(0, settings.getRetryBackoff().toMillis()) * (1L << (attempt - 1))));
        }
        throw new ExecutionProviderException("Execution provider request failed", true);
    }

    private boolean isTransient(HttpStatusCode status) {
        return status.value() == 429 || status.is5xxServerError();
    }

    private void sleep(long delayMs) {
        try {
            Thread.sleep(delayMs);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new ExecutionProviderException("Execution provider request was interrupted", false, exception);
        }
    }

    private static Integer parseExitCode(String raw) {
        try {
            return raw == null || raw.isBlank() ? null : Integer.valueOf(raw.trim());
        } catch (NumberFormatException exception) {
            return null;
        }
    }

    private static String text(JsonNode root, String field) {
        JsonNode value = root.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        String text = value.asText();
        return text.isEmpty() ? null : text;
    }

    private static String join(String first, String second) {
        if (first == null) return second;
        if (second == null) return first;
        return first + second;
    }

    private record CompilerChoice(String wandboxLanguage, String preferredPrefix) {
        CompilerChoice {
            preferredPrefix = preferredPrefix.toLowerCase(Locale.ROOT);
        }
    }

    private record WandboxCompiler(String name, String language) {}

    private record CompilerCatalog(List<WandboxCompiler> compilers, Instant expiresAt) {}

    private record StoredResult(ProviderExecutionResult result, Instant expiresAt) {}

    private static final class ExecutionTimedOut extends RuntimeException {
        private ExecutionTimedOut() {
            super(null, null, false, false);
        }
    }
}
