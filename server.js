// ==========================================
// Endpoint: recibe el "code" del Embedded Signup
// y completa el registro del número en coexistencia
// ==========================================
app.post('/conectar-whatsapp', express.json(), async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Falta el código de autorización.' });
    }

    // 1. Intercambiar el "code" por un token de acceso
    const tokenResponse = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?` +
      new URLSearchParams({
        client_id: process.env.META_APP_ID,
        client_secret: process.env.META_APP_SECRET,
        code: code
      })
    );

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      console.error('[conectar-whatsapp] Error obteniendo token:', tokenData);
      return res.status(400).json({ error: 'No se pudo obtener el token.', detalle: tokenData });
    }

    const accessToken = tokenData.access_token;
    console.log('[conectar-whatsapp] Token de usuario obtenido correctamente.');

    // 2. Obtener las WABAs (WhatsApp Business Accounts) asociadas a este token
    const wabaResponse = await fetch(
      `https://graph.facebook.com/v21.0/me/businesses?access_token=${accessToken}`
    );
    const wabaData = await wabaResponse.json();
    console.log('[conectar-whatsapp] Negocios encontrados:', JSON.stringify(wabaData));

    // 3. Responder con lo obtenido (para inspección manual antes de automatizar el registro)
    res.json({
      ok: true,
      mensaje: 'Token obtenido. Revisa los logs de Render para ver los negocios/WABAs asociados.',
      access_token_recibido: true,
      negocios: wabaData
    });

  } catch (error) {
    console.error('[conectar-whatsapp] Error:', error);
    res.status(500).json({ error: 'Error interno.', detalle: error.message });
  }
});
