import { Play, SquareTerminal } from 'lucide-react';
import type { ExecutionLanguage, ExecutionLanguageOption } from '../../language';

type ExecutionToolbarProps = {
  activeFile: boolean;
  consoleOpen: boolean;
  language: ExecutionLanguage;
  languages: readonly ExecutionLanguageOption[];
  onLanguageChange: (language: ExecutionLanguage) => void;
  onRun: () => void;
  onToggleConsole: () => void;
  submitting: boolean;
};

export function ExecutionToolbar({
  activeFile,
  consoleOpen,
  language,
  languages,
  onLanguageChange,
  onRun,
  onToggleConsole,
  submitting
}: ExecutionToolbarProps) {
  return (
    <div className="execution-toolbar" aria-label="Execution controls" role="toolbar">
      <label className="execution-language-label">
        <span className="sr-only">Language</span>
        <select disabled={submitting} onChange={(event) => onLanguageChange(event.target.value as ExecutionLanguage)} value={language}>
          {languages.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>
      {language === 'java' && <span className="java-main-hint">Java entry class: Main</span>}
      <button
        aria-label={submitting ? 'Submitting…' : 'Run'}
        className="run-button"
        disabled={!activeFile || submitting}
        onClick={onRun}
        title={activeFile ? 'Run the current collaborative document' : 'Open a file to run code'}
        type="button"
      >
        <Play size={13} />
        <span className="control-label">{submitting ? 'Running…' : 'Run'}</span>
      </button>
      <button
        aria-label={consoleOpen ? 'Hide console' : 'Show console'}
        aria-pressed={consoleOpen}
        className="console-toggle"
        onClick={onToggleConsole}
        title={consoleOpen ? 'Hide console' : 'Show console'}
        type="button"
      >
        <SquareTerminal size={15} />
      </button>
    </div>
  );
}
