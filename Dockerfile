# Build the frontend, then run the API (which also serves the built frontend).
FROM denoland/deno:2.9.5 AS build
WORKDIR /app
COPY . .
# nodemailer is imported lazily (only when SMTP is configured), so cache it explicitly.
RUN deno task build && deno cache server/main.ts npm:nodemailer@6.9.16

FROM denoland/deno:2.9.5
WORKDIR /app
# PUID/PGID: the user the app runs as (Unraid convention: 99/100). Any non-root ids work.
ENV APP_ENV=production PORT=8000 DATA_DIR=/data UPLOAD_DIR=/data/uploads STATIC_DIR=/app/web/dist \
    PUID=1993 PGID=1993
COPY --from=build /app/deno.json /app/deno.lock ./
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /deno-dir /deno-dir
COPY docker-entrypoint.sh /usr/local/bin/snail-entrypoint
# Whatever PUID runs the app needs to read the code and write Deno's compile cache.
RUN chmod 755 /usr/local/bin/snail-entrypoint && chmod -R a+rX /app && chmod -R a+rwX /deno-dir && mkdir -p /data
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD ["deno", "eval", "const r = await fetch(`http://127.0.0.1:${Deno.env.get('PORT') ?? 8000}/api/health`); Deno.exit(r.ok ? 0 : 1)"]
# The entrypoint makes /data writable as root, then drops to PUID:PGID.
ENTRYPOINT ["/usr/local/bin/snail-entrypoint"]
# Everything was cached at build time, so start without contacting package registries.
CMD ["deno", "run", "--cached-only", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-sys", "server/main.ts"]
