# HTTPS certificates

Place your HTTPS certificate files here if you want Node to serve HTTPS directly.

Recommended names:

- `server.key`
- `server.crt`
- optional `ca.crt`

Then set these in `server/.env`:

```bash
SSL_KEY_PATH=./certs/server.key
SSL_CERT_PATH=./certs/server.crt
SSL_CA_PATH=./certs/ca.crt
HTTPS_PORT=4443
```

Do not commit real private keys.
