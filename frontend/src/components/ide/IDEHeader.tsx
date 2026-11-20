import { Bot, Copy, MoreHorizontal } from 'lucide-react';
import pearLogoUrl from '../../../assets/favicon.png';
import type { Member } from '../../types';

type IDEHeaderProps = {
  hiddenMemberCount: number;
  humanMemberCount: number;
  isLead: boolean;
  members: Member[];
  onCloseRoom: () => void;
  onCopyRoomCode: () => void;
  onLeaveRoom: () => void;
  onOpenProfile: () => void;
  onReturnToLanding: () => void;
  onSignOut: () => void;
  onToggleMenu: () => void;
  onToggleRoomLock: () => void;
  pearMenuOpen: boolean;
  roleLabel: string;
  roomCode: string;
  roomLocked: boolean;
  user: Member;
};

export function IDEHeader({
  hiddenMemberCount,
  humanMemberCount,
  isLead,
  members,
  onCloseRoom,
  onCopyRoomCode,
  onLeaveRoom,
  onOpenProfile,
  onReturnToLanding,
  onSignOut,
  onToggleMenu,
  onToggleRoomLock,
  pearMenuOpen,
  roleLabel,
  roomCode,
  roomLocked,
  user
}: IDEHeaderProps) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="brand brand-link" onClick={onReturnToLanding} type="button">
          <img alt="" className="brand-logo" src={pearLogoUrl} />
          <span>Pear Programming</span>
        </button>
        <button
          aria-label={`Copy room code ${roomCode}`}
          className="room-code-control"
          onClick={onCopyRoomCode}
          title="Copy room code"
          type="button"
        >
          <span>{roomCode}</span>
          <Copy aria-hidden="true" size={13} />
        </button>
        <span className={`role-chip ${isLead ? 'role-lead' : ''}`}>{roleLabel}</span>
        {roomLocked && <span className="role-chip">Locked</span>}
      </div>
      <div className="topbar-actions">
        <div className="collaborators" aria-label="Collaborators">
          <span className="online-dot" />
          <span className="online-count">{Math.max(1, humanMemberCount)} online</span>
          <div className="avatar-stack">
            {members.map((member) => member.id === user.id ? (
              <button
                className="avatar avatar-button"
                key={member.id}
                onClick={onOpenProfile}
                style={{ backgroundColor: `${member.color}22`, color: member.color }}
                title="View profile"
                type="button"
              >
                {member.avatarUrl ? <img alt="" src={member.avatarUrl} /> : initials(member.name)}
              </button>
            ) : (
              <span
                className={`avatar ${member.ai ? 'avatar-ai' : ''}`}
                key={member.id}
                style={{ backgroundColor: member.ai ? '#EEEDFE' : `${member.color}22`, color: member.color }}
                title={member.name}
              >
                {member.ai ? <Bot size={13} /> : member.avatarUrl ? <img alt="" src={member.avatarUrl} /> : initials(member.name)}
              </span>
            ))}
            {hiddenMemberCount > 0 && <span className="avatar avatar-overflow" title={`${hiddenMemberCount} more collaborators`}>+{hiddenMemberCount}</span>}
          </div>
        </div>
        <div className="pear-menu">
          <button
            aria-expanded={pearMenuOpen}
            aria-haspopup="menu"
            aria-label="Room menu"
            className="topbar-icon-button pear-menu-trigger"
            onClick={onToggleMenu}
            title="Room menu"
            type="button"
          >
            <MoreHorizontal size={18} />
          </button>
          {pearMenuOpen && (
            <div className="pear-menu-popover" role="menu">
              <button onClick={() => { onToggleMenu(); onOpenProfile(); }} role="menuitem" type="button">Profile</button>
              {isLead && <button onClick={onToggleRoomLock} role="menuitem" type="button">{roomLocked ? 'Unlock room' : 'Lock room'}</button>}
              <button onClick={onLeaveRoom} role="menuitem" type="button">Leave room</button>
              <button onClick={onSignOut} role="menuitem" type="button">Sign out</button>
              {isLead && <button className="danger-menu-item" onClick={onCloseRoom} role="menuitem" type="button">Close room</button>}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
