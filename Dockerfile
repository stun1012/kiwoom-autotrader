FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json server.mjs engine.mjs kiwoom.mjs web-security.mjs index.html volume-ui.js login.html ./
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8765
EXPOSE 8765
CMD ["node", "server.mjs"]
