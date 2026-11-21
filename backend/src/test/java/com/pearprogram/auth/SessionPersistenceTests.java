package com.pearprogram.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Sign-ins are stored in the database, so a session cookie keeps working after the backend restarts.
 */
@SpringBootTest(properties = {
        "spring.data.redis.host=127.0.0.1",
        "spring.data.redis.port=1",
        "spring.data.redis.timeout=100ms",
        "pearprogram.realtime.redis-broadcast-enabled=false",
        "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SessionPersistenceTests {
    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private JdbcTemplate jdbc;

    @Test
    void storesSignInInTheDatabaseAndRestoresItFromTheCookie() throws Exception {
        MvcResult signIn = mockMvc.perform(post("/api/auth/guest")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"Persisted Pear\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        String userId = objectMapper.readTree(signIn.getResponse().getContentAsString()).get("userId").asText();
        Cookie sessionCookie = signIn.getResponse().getCookie("SESSION");
        assertThat(sessionCookie).as("Spring Session cookie").isNotNull();

        Integer storedSessions = jdbc.queryForObject(
                "SELECT COUNT(*) FROM spring_session_attributes a JOIN spring_session s ON s.primary_id = a.session_primary_id",
                Integer.class);
        assertThat(storedSessions).isPositive();

        mockMvc.perform(get("/api/auth/session").cookie(sessionCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value(userId))
                .andExpect(jsonPath("$.displayName").value("Persisted Pear"));
    }
}
