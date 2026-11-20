package com.pearprogram.execution;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.ExpectedCount;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.net.SocketTimeoutException;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class WandboxExecutionProviderTests {
    private static final String COMPILERS = """
            [
              {"name":"cpython-head","language":"Python"},
              {"name":"cpython-2.7-head","language":"Python"},
              {"name":"cpython-3.14.0","language":"Python"},
              {"name":"openjdk-jdk-22+36","language":"Java"},
              {"name":"gcc-head-c","language":"C"},
              {"name":"gcc-13.2.0-c","language":"C"}
            ]
            """;
    private static final int PYTHON = 71;
    private static final int JAVA = 62;
    private static final int KOTLIN = 78;

    private final ExecutionLanguageRegistry languages = new ExecutionLanguageRegistry();

    @Test
    void runsCodeWithTheNewestStableCompilerAndReturnsTheResult() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://wandbox.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        expectCompilerList(server);
        server.expect(requestTo("http://wandbox.test/api/compile.json"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(jsonPath("$.compiler").value("cpython-3.14.0"))
                .andExpect(jsonPath("$.stdin").value("pear"))
                .andRespond(withSuccess(result("0", "", "", "raep\n", ""), MediaType.APPLICATION_JSON));
        WandboxExecutionProvider provider = provider(builder, settings());

        String token = provider.submit(new ProviderExecutionRequest(PYTHON, "print(input()[::-1])", "pear", 5));
        ProviderExecutionResult result = provider.getResult(token);

        assertThat(result.status()).isEqualTo(ExecutionStatus.COMPLETED);
        assertThat(result.stdout()).isEqualTo("raep\n");
        assertThat(result.exitCode()).isZero();
        assertThat(provider.getResult(token).status())
                .as("a result is handed out once")
                .isEqualTo(ExecutionStatus.FAILED);
        server.verify();
    }

    @Test
    void rewritesAPublicMainClassBecauseWandboxCompilesProgDotJava() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://wandbox.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        expectCompilerList(server);
        server.expect(requestTo("http://wandbox.test/api/compile.json"))
                .andExpect(jsonPath("$.compiler").value("openjdk-jdk-22+36"))
                .andExpect(jsonPath("$.code").value("class Main { public static void main(String[] a) {} }"))
                .andRespond(withSuccess(result("0", "", "", "", ""), MediaType.APPLICATION_JSON));

        provider(builder, settings()).submit(new ProviderExecutionRequest(JAVA,
                "public class Main { public static void main(String[] a) {} }", "", 5));

        assertThat(WandboxExecutionProvider.withPackagePrivateMain("  public final class Main {}"))
                .isEqualTo("  final class Main {}");
        server.verify();
    }

    @Test
    void classifiesCompileErrorsRuntimeErrorsAndSandboxKills() throws Exception {
        WandboxExecutionProvider provider = provider(RestClient.builder(), settings());
        ObjectMapper json = new ObjectMapper();

        ProviderExecutionResult compileError = provider.normalize(json.readTree(result("1", "", "prog.c:1: error", "", "")));
        assertThat(compileError.status()).isEqualTo(ExecutionStatus.COMPILATION_ERROR);
        assertThat(compileError.compileOutput()).isEqualTo("prog.c:1: error");

        ProviderExecutionResult warningOnly = provider.normalize(json.readTree(result("0", "", "warning: unused", "ok\n", "")));
        assertThat(warningOnly.status()).isEqualTo(ExecutionStatus.COMPLETED);

        ProviderExecutionResult runtimeError = provider.normalize(json.readTree(result("1", "", "", "", "ValueError: boom")));
        assertThat(runtimeError.status()).isEqualTo(ExecutionStatus.RUNTIME_ERROR);
        assertThat(runtimeError.stderr()).isEqualTo("ValueError: boom");

        ProviderExecutionResult killed = provider.normalize(json.readTree(result("137", "", "", "", "")));
        assertThat(killed.status()).isEqualTo(ExecutionStatus.TIMED_OUT);

        assertThatThrownBy(() -> provider.normalize(json.readTree("{\"program_output\":\"x\"}")))
                .isInstanceOf(ExecutionProviderException.class);
    }

    @Test
    void retriesRateLimitsAndReportsReadTimeoutsAsTimedOut() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://wandbox.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        expectCompilerList(server);
        server.expect(requestTo("http://wandbox.test/api/compile.json"))
                .andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS).body("Error: Too many requests"));
        server.expect(requestTo("http://wandbox.test/api/compile.json"))
                .andRespond(withSuccess(result("0", "", "", "1\n", ""), MediaType.APPLICATION_JSON));
        server.expect(ExpectedCount.once(), requestTo("http://wandbox.test/api/compile.json"))
                .andRespond(request -> { throw new SocketTimeoutException("Read timed out"); });
        WandboxExecutionProvider provider = provider(builder, settings());

        String retried = provider.submit(new ProviderExecutionRequest(PYTHON, "print(1)", "", 5));
        assertThat(provider.getResult(retried).stdout()).isEqualTo("1\n");

        String slow = provider.submit(new ProviderExecutionRequest(PYTHON, "while True: pass", "", 5));
        assertThat(provider.getResult(slow).status()).isEqualTo(ExecutionStatus.TIMED_OUT);
        server.verify();
    }

    @Test
    void rejectsLanguagesWandboxCannotRun() {
        WandboxExecutionProvider provider = provider(RestClient.builder(), settings());

        assertThat(provider.supportsLanguage("kotlin")).isFalse();
        assertThat(provider.supportsLanguage("swift")).isFalse();
        assertThat(provider.supportsLanguage("py")).isTrue();
        assertThatThrownBy(() -> provider.submit(new ProviderExecutionRequest(KOTLIN, "fun main() {}", "", 5)))
                .isInstanceOfSatisfying(ExecutionProviderException.class,
                        exception -> assertThat(exception.isTransientFailure()).isFalse());
    }

    private void expectCompilerList(MockRestServiceServer server) {
        server.expect(ExpectedCount.once(), requestTo("http://wandbox.test/api/list.json"))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess(COMPILERS, MediaType.APPLICATION_JSON));
    }

    private WandboxExecutionProvider provider(RestClient.Builder builder, ExecutionProperties properties) {
        return new WandboxExecutionProvider(builder.build(), new ObjectMapper(), languages, properties);
    }

    private ExecutionProperties settings() {
        ExecutionProperties properties = new ExecutionProperties();
        properties.getWandbox().setRetryBackoff(Duration.ZERO);
        return properties;
    }

    private static String result(String status, String compilerOutput, String compilerError, String stdout, String stderr) {
        return """
                {"status":"%s","signal":"","compiler_output":"%s","compiler_error":"%s","program_output":"%s","program_error":"%s"}
                """.formatted(status, escape(compilerOutput), escape(compilerError), escape(stdout), escape(stderr));
    }

    private static String escape(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n");
    }
}
