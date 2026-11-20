package com.pearprogram.realtime;

import com.pearprogram.ai.AiParticipantService;
import com.pearprogram.auth.GuestPrincipal;
import com.pearprogram.rooms.EphemeralRoomStateService;
import com.pearprogram.rooms.RoomService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RoomEventControllerIdentityTests {
    @Test
    void replacesClientSuppliedCursorIdentityWithTheAuthenticatedPrincipal() {
        RealtimeBroadcastService broadcasts = mock(RealtimeBroadcastService.class);
        RoomEventController controller = new RoomEventController(
                broadcasts,
                mock(RoomService.class),
                mock(EphemeralRoomStateService.class),
                mock(RoomPresenceEventService.class),
                mock(AiParticipantService.class),
                null
        );
        GuestPrincipal principal = new GuestPrincipal(UUID.randomUUID(), "Authenticated User", null);
        var authentication = UsernamePasswordAuthenticationToken.authenticated(principal, null, List.of());

        controller.cursor("ABC123", new CursorMessage(
                "impersonated-user",
                "Impostor",
                "file-1",
                4,
                7,
                "#ffffff",
                123L
        ), authentication);

        ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
        verify(broadcasts).broadcast(org.mockito.ArgumentMatchers.eq("/topic/room/ABC123/cursors"), payload.capture());
        CursorMessage outbound = (CursorMessage) payload.getValue();
        assertThat(outbound.userId()).isEqualTo(principal.id());
        assertThat(outbound.displayName()).isEqualTo(principal.displayName());
    }

    @Test
    void relaysFileTreeEventsWithoutPersistingThem() {
        RealtimeBroadcastService broadcasts = mock(RealtimeBroadcastService.class);
        RoomService rooms = mock(RoomService.class);
        RoomEventController controller = new RoomEventController(
                broadcasts,
                rooms,
                mock(EphemeralRoomStateService.class),
                mock(RoomPresenceEventService.class),
                mock(AiParticipantService.class),
                null
        );
        GuestPrincipal principal = new GuestPrincipal(UUID.randomUUID(), "Member", null);
        var authentication = UsernamePasswordAuthenticationToken.authenticated(principal, null, List.of());

        controller.projectSwitch("ABC123", projectSwitch("files-updated", List.of()), authentication);
        controller.projectSwitch("ABC123", projectSwitch("accepted", List.of()), authentication);
        controller.projectSwitch("ABC123", projectSwitch("file-content-updated",
                List.of(java.util.Map.of("id", "file-1", "content", "x"))), authentication);

        org.mockito.Mockito.verify(rooms, org.mockito.Mockito.never()).saveRoomFiles(any(), any());
        org.mockito.Mockito.verify(rooms).updateRoomFileContents(org.mockito.ArgumentMatchers.eq("ABC123"), any());
        org.mockito.Mockito.verify(broadcasts, org.mockito.Mockito.times(3))
                .broadcast(org.mockito.ArgumentMatchers.eq("/topic/room/ABC123/project-switch"), any());
    }

    private ProjectSwitchEvent projectSwitch(String type, List<java.util.Map<String, Object>> files) {
        return new ProjectSwitchEvent(type, "proposal", null, null, null, null, null, null, null,
                null, null, true, false, files, null);
    }

    @Test
    void broadcastsPearAiOnlyForThePearAiMention() {
        RealtimeBroadcastService broadcasts = mock(RealtimeBroadcastService.class);
        EphemeralRoomStateService roomState = mock(EphemeralRoomStateService.class);
        AiParticipantService pearAi = mock(AiParticipantService.class);
        when(roomState.roomExists("ABC123")).thenReturn(true);
        when(pearAi.chatResponse(any(), any(), any(), any(), any())).thenReturn("A concise answer.");
        RoomEventController controller = new RoomEventController(
                broadcasts,
                mock(RoomService.class),
                roomState,
                mock(RoomPresenceEventService.class),
                pearAi,
                null
        );
        GuestPrincipal principal = new GuestPrincipal(UUID.randomUUID(), "Authenticated User", null);
        var authentication = UsernamePasswordAuthenticationToken.authenticated(principal, null, List.of());

        controller.chat("ABC123", message("Can @PearAI help?"), authentication);
        controller.chat("ABC123", message("Can @AI still help?"), authentication);

        ArgumentCaptor<Object> payloads = ArgumentCaptor.forClass(Object.class);
        verify(broadcasts, times(3)).broadcast(eq("/topic/room/ABC123/chat"), payloads.capture());
        assertThat(payloads.getAllValues().stream()
                .filter(ChatOutboundMessage.class::isInstance)
                .map(ChatOutboundMessage.class::cast)
                .filter(ChatOutboundMessage::ai)
                .map(ChatOutboundMessage::displayName))
                .containsExactly("PearAI");
    }

    private ChatInboundMessage message(String content) {
        return new ChatInboundMessage("ignored", "Ignored", content, "file-1", "main.ts", 4, "const pear = true;");
    }
}
