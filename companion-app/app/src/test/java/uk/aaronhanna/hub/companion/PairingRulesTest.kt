package uk.aaronhanna.hub.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingRulesTest {

    @Test
    fun `keeps a full address as typed, minus a trailing slash or api path`() {
        assertEquals("http://192.168.1.20:8090", PairingRules.normaliseUrl(" http://192.168.1.20:8090/ "))
        assertEquals("https://hub.aaronhanna.uk", PairingRules.normaliseUrl("https://hub.aaronhanna.uk/api"))
    }

    @Test
    fun `fills in the scheme — http on the home network, https anywhere else`() {
        assertEquals("http://192.168.1.20:8090", PairingRules.normaliseUrl("192.168.1.20:8090"))
        assertEquals("http://nas.local:8090", PairingRules.normaliseUrl("nas.local:8090"))
        assertEquals("https://hub.aaronhanna.uk", PairingRules.normaliseUrl("hub.aaronhanna.uk"))
    }

    @Test
    fun `refuses things that aren't an address`() {
        assertNull(PairingRules.normaliseUrl(""))
        assertNull(PairingRules.normaliseUrl("my hub"))
        assertNull(PairingRules.normaliseUrl("ftp://192.168.1.20"))
        assertNull(PairingRules.normaliseUrl("http://"))
    }

    @Test
    fun `accepts a hub token and explains what's wrong with anything else`() {
        assertNull(PairingRules.tokenProblem("  hub_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_ab  "))
        assertNotNull(PairingRules.tokenProblem(""))
        assertTrue(PairingRules.tokenProblem("sk-ant-abc123")!!.contains("hub_"))
        assertTrue(PairingRules.tokenProblem("hub_abc")!!.contains("cut short"))
    }

    @Test
    fun `warns only about plain http beyond the home network`() {
        assertTrue(PairingRules.isInsecureRemote("http://hub.aaronhanna.uk"))
        assertTrue(PairingRules.isInsecureRemote("http://81.2.3.4:8090"))
        assertFalse(PairingRules.isInsecureRemote("https://hub.aaronhanna.uk"))
        for (lan in listOf("http://192.168.1.20:8090", "http://10.0.0.5", "http://172.20.1.1", "http://nas.local", "http://localhost:3000")) {
            assertFalse(lan, PairingRules.isInsecureRemote(lan))
        }
    }
}
