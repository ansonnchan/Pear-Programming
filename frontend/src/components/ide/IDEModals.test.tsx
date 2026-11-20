import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreateItemModal, EntryProfileModal } from './IDEModals';

describe('EntryProfileModal', () => {
  it('uses the light entry treatment while retaining temporary-profile setup', () => {
    const { container } = render(
      <EntryProfileModal
        action="create"
        avatarInputRef={createRef<HTMLInputElement>()}
        color="#627d31"
        error=""
        name=""
        onAvatarInput={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onNameChange={vi.fn()}
      />
    );

    expect(container.querySelector('.modal-backdrop')).toHaveClass('entry-profile-backdrop');
    expect(screen.getByRole('dialog', { name: 'Set up profile' })).toHaveClass('entry-profile-modal');
    expect(screen.getByRole('button', { name: 'Upload Photo' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Display name' })).toHaveFocus();
  });
});

describe('CreateItemModal', () => {
  it('confirms once when Enter is pressed in the name field', () => {
    const onConfirm = vi.fn();
    render(<CreateItemModal error="" kind="file" name="main.py" onCancel={vi.fn()} onConfirm={onConfirm} onNameChange={vi.fn()} />);

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
