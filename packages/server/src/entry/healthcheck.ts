// Distroless images have no shell or curl, so the container health check runs on Node.
fetch(`http://127.0.0.1:${process.env.PORT ?? 8080}/v1/health`)
  .then((res) => process.exit(res.ok ? 0 : 1))
  .catch(() => process.exit(1));
