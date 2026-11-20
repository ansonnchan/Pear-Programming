import Editor, { type OnMount } from '@monaco-editor/react';
import { X } from 'lucide-react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { languageClass, type ExecutionLanguage, type ExecutionLanguageOption } from '../../language';
import type { ExecutionResult, WorkspaceFile } from '../../types';
import { ExecutionConsole } from '../execution/ExecutionConsole';
import { ExecutionToolbar } from '../execution/ExecutionToolbar';

type EditorWorkspaceProps = {
  activeFile: WorkspaceFile | null;
  consoleHeight: number;
  consoleMaximumHeight: number;
  consoleMinimumHeight: number;
  consoleOpen: boolean;
  consoleResizing: boolean;
  editorStackRef: RefObject<HTMLDivElement>;
  executionError: string;
  executionLanguage: ExecutionLanguage;
  executionLanguages: readonly ExecutionLanguageOption[];
  executionResult: ExecutionResult | null;
  executionSubmitting: boolean;
  onActiveFileChange: (fileId: string) => void;
  onClearConsole: () => void;
  onCloseFile: (fileId: string) => void;
  onConsoleHeightChange: (height: number) => void;
  onConsoleResizeKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onConsoleResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onEditorMount: OnMount;
  onLanguageChange: (language: ExecutionLanguage) => void;
  onOpenUpload: () => void;
  onRun: () => void;
  onToggleConsole: () => void;
  openFiles: WorkspaceFile[];
};

export function EditorWorkspace({
  activeFile,
  consoleHeight,
  consoleMaximumHeight,
  consoleMinimumHeight,
  consoleOpen,
  consoleResizing,
  editorStackRef,
  executionError,
  executionLanguage,
  executionLanguages,
  executionResult,
  executionSubmitting,
  onActiveFileChange,
  onClearConsole,
  onCloseFile,
  onConsoleHeightChange,
  onConsoleResizeKeyDown,
  onConsoleResizeStart,
  onEditorMount,
  onLanguageChange,
  onOpenUpload,
  onRun,
  onToggleConsole,
  openFiles
}: EditorWorkspaceProps) {
  return (
    <section className={`editor-area ${consoleResizing ? 'console-resizing' : ''}`}>
      <div className="editor-toolbar-row">
        <EditorTabs activeFileId={activeFile?.id ?? null} files={openFiles} onActivate={onActiveFileChange} onClose={onCloseFile} />
        <ExecutionToolbar
          activeFile={Boolean(activeFile)}
          consoleOpen={consoleOpen}
          language={executionLanguage}
          languages={executionLanguages}
          onLanguageChange={onLanguageChange}
          onRun={onRun}
          onToggleConsole={onToggleConsole}
          submitting={executionSubmitting}
        />
      </div>
      <div className="editor-stack" ref={editorStackRef}>
        <div className="editor-frame">
          {activeFile ? (
            <Editor
              height="100%"
              language={activeFile.language}
              onMount={onEditorMount}
              options={{
                automaticLayout: true,
                fixedOverflowWidgets: true,
                fontFamily: 'JetBrains Mono, Consolas, monospace',
                fontSize: 14,
                lineHeight: 22,
                minimap: { enabled: false },
                padding: { top: 14, bottom: 14 },
                scrollbar: { horizontalScrollbarSize: 10, verticalScrollbarSize: 10 },
                scrollBeyondLastLine: false,
                suggestFontSize: 14,
                suggestLineHeight: 28,
                tabSize: 2
              }}
              path={activeFile.path}
              theme="pear-light"
              defaultValue={activeFile.content}
            />
          ) : (
            <EmptyEditorState onOpenUpload={onOpenUpload} />
          )}
        </div>
        <div
          aria-hidden={!consoleOpen}
          className={`console-region ${consoleOpen ? '' : 'console-region-collapsed'}`}
          style={{ flexBasis: consoleOpen ? `${Math.min(consoleHeight, consoleMaximumHeight)}px` : '0px' }}
        >
          <div
            aria-controls="execution-console"
            aria-label="Resize console"
            aria-orientation="horizontal"
            aria-valuemax={consoleMaximumHeight}
            aria-valuemin={consoleMinimumHeight}
            aria-valuenow={Math.min(consoleHeight, consoleMaximumHeight)}
            className="console-resize-handle"
            onDoubleClick={() => onConsoleHeightChange(250)}
            onKeyDown={onConsoleResizeKeyDown}
            onPointerDown={onConsoleResizeStart}
            role="separator"
            tabIndex={consoleOpen ? 0 : -1}
            title="Drag to resize console; double-click to reset"
          >
            <span />
          </div>
          <ExecutionConsole
            error={executionError}
            onClear={onClearConsole}
            onRerun={onRun}
            result={executionResult}
            submitting={executionSubmitting}
          />
        </div>
      </div>
    </section>
  );
}

type EditorTabsProps = {
  activeFileId: string | null;
  files: WorkspaceFile[];
  onActivate: (fileId: string) => void;
  onClose: (fileId: string) => void;
};

export function EditorTabs({ activeFileId, files, onActivate, onClose }: EditorTabsProps) {
  return (
    <div className="tabs">
      {files.map((file) => (
        <div className={`tab ${file.id === activeFileId ? 'tab-active' : ''}`} key={file.id}>
          <button className="tab-main" onClick={() => onActivate(file.id)} title={file.path} type="button">
            <span className={`language-dot ${languageClass(file.language)}`} />
            <span>{basename(file.path)}</span>
          </button>
          <button className="tab-close" onClick={() => onClose(file.id)} title={`Close ${basename(file.path)}`} type="button">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function EmptyEditorState({ onOpenUpload }: { onOpenUpload: () => void }) {
  return (
    <div className="empty-editor">
      <p>
        Open a file from the sidebar, or{' '}
        <button className="link-button" onClick={onOpenUpload} type="button">upload a project</button>
        {' '}to start coding together.
      </p>
    </div>
  );
}

function basename(path: string) {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}
