package com.pearprogram.execution;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/execution/languages")
public class ExecutionLanguageController {
    private final ExecutionLanguageRegistry languages;
    private final ExecutionProvider provider;

    public ExecutionLanguageController(ExecutionLanguageRegistry languages, ExecutionProvider provider) {
        this.languages = languages;
        this.provider = provider;
    }

    @GetMapping
    public List<ExecutionLanguageOption> list() {
        return languages.options().stream()
                .filter(option -> provider.supportsLanguage(option.id()))
                .toList();
    }
}
