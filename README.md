# notepad.pw-recreated

An improved, FOSS version of [notepad.pw](https://notepad.pw), recreated for
self-hosting and continued development.

A self-hosted, real-time collaborative notepad with optional password
protection, Markdown preview, syntax-aware editing, and local MongoDB storage.

## Requirements

- [Bun](https://bun.sh/)
- MongoDB, either local or through Docker

## Local development

```bash
cp .env.example .env
bun install
bun run dev
```

Open `http://localhost:<PORT>`. The default port is `4040`.

For a local MongoDB installation, the example configuration uses:
`mongodb://localhost:27017/notepad`.

## Docker Compose

Copy `.env.docker.example` to `.env`, then run:

```bash
docker compose up --build
```

Compose loads the application settings from `.env` and overrides `MONGO_URI`
with `mongodb://mongo:27017/notepad`, so the app connects to the MongoDB
container. MongoDB data is persisted in the `mongo-data` Docker volume. The app
is available at `http://localhost:<PORT>`.

Stop the services with:

```bash
docker compose down
```

## Configuration

| Variable | Description |
| --- | --- |
| `MONGO_URI` | MongoDB connection string |
| `PORT` | HTTP and WebSocket listening port |
| `TRUST_PROXY` | Set to `true` only when running behind a trusted proxy |
| `MONGO_POOL_SIZE` | Maximum MongoDB connection pool size |
| `MONGO_MIN_POOL_SIZE` | Minimum MongoDB connection pool size |
| `NEW_NOTE_LENGTH` | Length of generated note IDs |
| `NODE_ENV` | Use `production` to disable development logs |


## Passwords and sessions

New passwords must be 8-64 alphanumeric characters and include at least one
uppercase and one lowercase letter. Passwords are hashed with Argon2 before
storage. The optional remembered-password feature stores a note password in
the browser's localStorage; use **Log out** on shared devices.

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE).


Personal, educational, research, and other noncommercial uses are permitted. Commercial use requires separate permission from the copyright holder.
