FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates chromium \
    && rm -rf /var/lib/apt/lists/*
# Real Kane CLI (only used when KANE_BIN is set in Render)
RUN npm install -g @testmuai/kane-cli
WORKDIR /app
COPY . .
RUN chmod +x demo/fake-kane.mjs kane-wrapper.sh && chown -R node:node /app
USER node
RUN git config --global user.email "web@culprit.local" && git config --global user.name "culprit-web"
ENV PORT=8080 KANE_CLI_CHROME_PATH=/usr/bin/chromium
EXPOSE 8080
CMD ["node","web.mjs"]
