package com.pearprogram.execution;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * Runs a small program in every Wandbox-supported language against the real public service.
 * Opt-in only, so CI never depends on a third-party service: run with WANDBOX_LIVE=true mvn -Dtest=WandboxLiveCheckTests test
 * (optionally WANDBOX_LANGUAGES=go,rust to check a subset).
 */
class WandboxLiveCheckTests {
    private static final Map<String, String> PROGRAMS = new LinkedHashMap<>();

    static {
        PROGRAMS.put("java", "public class Main { public static void main(String[] args) { System.out.println(\"pear\"); } }");
        PROGRAMS.put("python", "print('pear')");
        PROGRAMS.put("javascript", "console.log('pear');");
        PROGRAMS.put("c", "#include <stdio.h>\nint main(void) { puts(\"pear\"); return 0; }");
        PROGRAMS.put("cpp", "#include <iostream>\nint main() { std::cout << \"pear\" << std::endl; }");
        PROGRAMS.put("typescript", "const fruit: string = 'pear';\nconsole.log(fruit);");
        PROGRAMS.put("sql", "SELECT 'pear';");
        PROGRAMS.put("csharp", "using System;\nclass Program { static void Main() { Console.WriteLine(\"pear\"); } }");
        PROGRAMS.put("php", "<?php echo \"pear\\n\";");
        PROGRAMS.put("ruby", "puts 'pear'");
        PROGRAMS.put("go", "package main\nimport \"fmt\"\nfunc main() { fmt.Println(\"pear\") }");
        PROGRAMS.put("rust", "fn main() { println!(\"pear\"); }");
        PROGRAMS.put("r", "cat('pear\\n')");
        PROGRAMS.put("shell", "echo pear");
    }

    @Test
    void everySupportedLanguageRunsOnWandbox() throws Exception {
        assumeTrue("true".equalsIgnoreCase(System.getenv("WANDBOX_LIVE")), "WANDBOX_LIVE is not set");
        ExecutionProperties properties = new ExecutionProperties();
        properties.getWandbox().setRequestTimeout(java.time.Duration.ofSeconds(30));
        ExecutionLanguageRegistry languages = new ExecutionLanguageRegistry();
        WandboxExecutionProvider provider = new WandboxExecutionProvider(
                new WandboxClientConfig().wandboxRestClient(properties), new ObjectMapper(), languages, properties);

        Map<String, String> failures = new LinkedHashMap<>();
        String only = System.getenv("WANDBOX_LANGUAGES");
        for (Map.Entry<String, String> program : PROGRAMS.entrySet()) {
            if (only != null && !only.isBlank() && !java.util.List.of(only.split(",")).contains(program.getKey())) {
                continue;
            }
            int languageId = languages.judge0Id(program.getKey()).orElseThrow();
            ProviderExecutionResult result = provider.getResult(
                    provider.submit(new ProviderExecutionRequest(languageId, program.getValue(), "", 5)));
            String output = result.stdout() == null ? "" : result.stdout().trim();
            System.out.printf("%-10s %-18s %s%n", program.getKey(), result.status(), output);
            if (result.status() != ExecutionStatus.COMPLETED || !output.contains("pear")) {
                failures.put(program.getKey(), result.status() + " stdout=" + result.stdout()
                        + " stderr=" + result.stderr() + " compile=" + result.compileOutput());
            }
            Thread.sleep(6_000); // stay under Wandbox's rate limit
        }
        assertThat(failures).isEmpty();
    }
}
