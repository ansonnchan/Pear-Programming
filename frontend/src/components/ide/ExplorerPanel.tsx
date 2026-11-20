import { Check, Download, FolderPlus, FolderUp, PanelLeftClose, PanelLeftOpen, Plus, Upload, X, FilePlus2 } from 'lucide-react';
import type { DragEvent, RefObject } from 'react';
import { UPLOAD_ACCEPT } from '../../uploads';
import type { WorkspaceFile } from '../../types';
import { FileTree } from '../file-tree/FileTree';

type ExplorerPanelProps = {
  activeFileId: string;
  activeProjectName: string;
  createMenuOpen: boolean;
  expandedFolders: Set<string>;
  fileInputRef: RefObject<HTMLInputElement>;
  files: WorkspaceFile[];
  folderInputRef: RefObject<HTMLInputElement>;
  onCreateMenuChange: (open: boolean) => void;
  onDeletePath: (path: string, kind: 'file' | 'folder') => void;
  onDownload: () => void;
  onFileSelect: (fileId: string) => void;
  onFolderUploadInput: (input: HTMLInputElement) => void;
  onHide: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onOpenFilePicker: () => void;
  onOpenFolderPicker: () => void;
  onShow: () => void;
  onToggleFolder: (path: string) => void;
  onUploadDrop: (event: DragEvent<HTMLElement>) => void;
  onUploadInput: (input: HTMLInputElement) => void;
  onUploadNoticeChange: (notice: string) => void;
  onUploadDraggingChange: (dragging: boolean) => void;
  open: boolean;
  uploadDragging: boolean;
  uploadModalOpen: boolean;
  uploadNotice: string;
};

export function ExplorerPanel(props: ExplorerPanelProps) {
  if (!props.open) {
    return (
      <aside className="explorer-rail">
        <button aria-controls="workspace-explorer" aria-expanded="false" aria-label="Show explorer" className="panel-rail-button" onClick={props.onShow} title="Show explorer" type="button">
          <PanelLeftOpen size={18} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      className={`explorer ${props.uploadDragging && !props.uploadModalOpen ? 'explorer-dragging' : ''}`}
      id="workspace-explorer"
      onDragEnter={(event) => {
        event.preventDefault();
        props.onUploadDraggingChange(true);
      }}
      onDragLeave={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          props.onUploadDraggingChange(false);
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        props.onUploadDraggingChange(true);
      }}
      onDrop={props.onUploadDrop}
    >
      <div className="pane-title-row">
        <span className="pane-title">Files</span>
        <div className="icon-row">
          <button aria-label="Upload files" className="icon-button" onClick={props.onOpenFilePicker} title="Upload files" type="button">
            <Upload size={15} />
          </button>
          <button aria-label="Upload folder" className="icon-button" onClick={props.onOpenFolderPicker} title="Upload folder" type="button">
            <FolderUp size={15} />
          </button>
          <div className="explorer-create-menu">
            <button aria-expanded={props.createMenuOpen} aria-label="Create file or folder" className="icon-button explorer-create-button" onClick={() => props.onCreateMenuChange(!props.createMenuOpen)} title="Create file or folder" type="button">
              <Plus size={16} />
            </button>
            {props.createMenuOpen && (
              <div className="explorer-create-popover">
                <button onClick={() => { props.onCreateMenuChange(false); props.onNewFile(); }} type="button"><FilePlus2 size={15} /> New file</button>
                <button onClick={() => { props.onCreateMenuChange(false); props.onNewFolder(); }} type="button"><FolderPlus size={15} /> New folder</button>
              </div>
            )}
          </div>
          <button aria-label="Hide explorer" className="icon-button panel-minimize-button" onClick={props.onHide} type="button" title="Hide explorer">
            <PanelLeftClose size={16} />
          </button>
        </div>
      </div>
      <input className="hidden-file-input" multiple accept={UPLOAD_ACCEPT} onChange={(event) => props.onUploadInput(event.currentTarget)} ref={props.fileInputRef} type="file" />
      <input className="hidden-file-input" multiple onChange={(event) => props.onFolderUploadInput(event.currentTarget)} ref={props.folderInputRef} type="file" />
      {props.uploadNotice && (
        <div className="upload-notice" role="status">
          <span className="upload-notice-icon"><Check size={15} /></span>
          <p>{props.uploadNotice}</p>
          <button onClick={() => props.onUploadNoticeChange('')} type="button" title="Dismiss upload notice"><X size={13} /></button>
        </div>
      )}
      <section className="explorer-section workspace-section" aria-labelledby="workspace-section-title">
        <div className="explorer-section-heading">
          <span id="workspace-section-title" title={props.activeProjectName}>Workspace</span>
          <button aria-label="Download project" className="icon-button" disabled={props.files.length === 0} onClick={props.onDownload} title="Download project" type="button">
            <Download size={15} />
          </button>
        </div>
        <div className="tree">
          <FileTree
            activeFileId={props.activeFileId}
            expandedFolders={props.expandedFolders}
            files={props.files}
            onDeletePath={props.onDeletePath}
            onFileSelect={props.onFileSelect}
            onToggleFolder={props.onToggleFolder}
          />
        </div>
      </section>
      {props.uploadDragging && !props.uploadModalOpen && (
        <div className="explorer-drop-overlay" aria-hidden="true">
          <Upload size={24} />
          <strong>Drop to share</strong>
        </div>
      )}
    </aside>
  );
}
