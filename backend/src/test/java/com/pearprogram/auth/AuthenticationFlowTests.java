package com.pearprogram.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "spring.data.redis.host=127.0.0.1",
        "spring.data.redis.port=1",
        "spring.data.redis.timeout=100ms",
        "pearprogram.realtime.redis-broadcast-enabled=false"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AuthenticationFlowTests {
    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private UserRepository users;

    @Test
    void createsAndRestoresServerIssuedIdentity() throws Exception {
        SignIn signIn = signIn("Alice", "attacker-controlled-id");

        assertThat(signIn.userId()).isNotEqualTo("attacker-controlled-id");
        assertThat(users.findById(java.util.UUID.fromString(signIn.userId())).orElseThrow().getDisplayName())
                .isEqualTo("Alice");
        mockMvc.perform(get("/api/auth/session").session(signIn.session()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value(signIn.userId()))
                .andExpect(jsonPath("$.displayName").value("Alice"));
    }

    @Test
    void rejectsInvalidIdentityCreationAndAnonymousProtectedAccess() throws Exception {
        mockMvc.perform(post("/api/auth/guest")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"   \"}"))
                .andExpect(status().isBadRequest());

        mockMvc.perform(post("/api/rooms/create").with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void updatesProfileAndLogsOut() throws Exception {
        SignIn signIn = signIn("Alice", null);
        mockMvc.perform(patch("/api/auth/profile")
                        .session(signIn.session())
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"Alice Updated\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value(signIn.userId()))
                .andExpect(jsonPath("$.displayName").value("Alice Updated"));
        assertThat(users.findById(java.util.UUID.fromString(signIn.userId())).orElseThrow().getDisplayName())
                .isEqualTo("Alice Updated");

        mockMvc.perform(post("/api/auth/logout").session(signIn.session()).with(csrf()))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/auth/session").session(signIn.session()))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void ignoresClientSuppliedRoomIdentityAndEnforcesRoomMembership() throws Exception {
        SignIn owner = signIn("Owner", null);
        JsonNode room = json(mockMvc.perform(post("/api/rooms/create")
                        .session(owner.session())
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sessionId\":\"impersonated\",\"displayName\":\"Impostor\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        String code = room.path("code").asText();

        mockMvc.perform(get("/api/rooms/{code}", code).session(owner.session()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.leadUserId").value(owner.userId()));

        SignIn outsider = signIn("Outsider", null);
        mockMvc.perform(get("/api/rooms/{code}", code).session(outsider.session()))
                .andExpect(status().isForbidden());
    }

    @Test
    void enforcesWorkspaceOwnership() throws Exception {
        SignIn owner = signIn("Owner", null);
        JsonNode workspace = json(mockMvc.perform(post("/api/workspaces")
                        .session(owner.session())
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"secure-workspace\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        JsonNode file = json(mockMvc.perform(post("/api/workspaces/{id}/files", workspace.path("id").asText())
                        .session(owner.session())
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"path\":\"private.txt\",\"content\":\"secret\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());

        SignIn outsider = signIn("Outsider", null);
        mockMvc.perform(get("/api/workspaces/{id}", workspace.path("id").asText()).session(outsider.session()))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/files/{id}", file.path("id").asText()).session(outsider.session()))
                .andExpect(status().isForbidden());
    }

    @Test
    void requiresAuthenticationForSockJsHandshake() throws Exception {
        mockMvc.perform(get("/ws/info"))
                .andExpect(status().isUnauthorized());

        SignIn signIn = signIn("Socket User", null);
        mockMvc.perform(get("/ws/info").session(signIn.session()))
                .andExpect(status().isOk());
    }

    @Test
    void validatesRealtimeTokenOnlyAfterRoomMembership() throws Exception {
        SignIn signIn = signIn("Realtime User", null);
        mockMvc.perform(get("/internal/auth/realtime/validate")
                        .param("token", signIn.realtimeToken())
                        .param("roomCode", "ABC123")
                        .param("fileId", java.util.UUID.randomUUID().toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(false));

        String roomCode = createRoom(signIn);
        String fileId = createRoomFile(signIn, roomCode, "Main.java");
        mockMvc.perform(get("/internal/auth/realtime/validate")
                        .param("token", signIn.realtimeToken())
                        .param("roomCode", roomCode)
                        .param("fileId", fileId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(true))
                .andExpect(jsonPath("$.userId").value(signIn.userId()));
    }

    @Test
    void rejectsRealtimeAccessToFilesFromAnotherRoom() throws Exception {
        SignIn owner = signIn("File Owner", null);
        String ownerRoom = createRoom(owner);
        String ownerFile = createRoomFile(owner, ownerRoom, "secret.py");

        SignIn other = signIn("Other Room User", null);
        String otherRoom = createRoom(other);

        mockMvc.perform(get("/internal/auth/realtime/validate")
                        .param("token", other.realtimeToken())
                        .param("roomCode", otherRoom)
                        .param("fileId", ownerFile))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(false));
        mockMvc.perform(get("/internal/auth/realtime/validate")
                        .param("token", other.realtimeToken())
                        .param("roomCode", otherRoom))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(false));
        mockMvc.perform(get("/internal/files/" + ownerFile + "/snapshot").param("roomCode", otherRoom))
                .andExpect(status().isNotFound());
        mockMvc.perform(post("/internal/files/" + ownerFile + "/snapshot")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"roomCode\":\"" + otherRoom + "\",\"encodedState\":\"\",\"plainText\":\"overwritten\"}"))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/internal/files/" + ownerFile + "/snapshot").param("roomCode", ownerRoom))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.plainText").value("print('pear')"));
    }

    private String createRoom(SignIn signIn) throws Exception {
        JsonNode room = json(mockMvc.perform(post("/api/rooms/create")
                        .session(signIn.session())
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        return room.path("code").asText();
    }

    private String createRoomFile(SignIn signIn, String roomCode, String path) throws Exception {
        JsonNode files = json(mockMvc.perform(put("/api/rooms/" + roomCode + "/files")
                        .session(signIn.session())
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"files\":[{\"path\":\"" + path + "\",\"content\":\"print('pear')\"}]}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        return files.path(0).path("id").asText();
    }

    private SignIn signIn(String displayName, String suppliedUserId) throws Exception {
        String extra = suppliedUserId == null ? "" : ",\"userId\":\"" + suppliedUserId + "\"";
        var result = mockMvc.perform(post("/api/auth/guest")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"" + displayName + "\"" + extra + "}"))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode body = json(result.getResponse().getContentAsString());
        return new SignIn(
                (MockHttpSession) result.getRequest().getSession(false),
                body.path("userId").asText(),
                body.path("realtimeToken").asText()
        );
    }

    private JsonNode json(String raw) throws Exception {
        return objectMapper.readTree(raw);
    }

    private record SignIn(MockHttpSession session, String userId, String realtimeToken) {}
}
