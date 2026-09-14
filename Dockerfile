FROM node:22-bookworm-slim

WORKDIR /app

# 先安装依赖以利用层缓存
COPY web/package.json web/
COPY server/package.json server/
RUN cd web && npm install
RUN cd ../server && npm install

# 构建前端
COPY web web/
RUN cd web && npm run build

# 后端源码
COPY server server/

WORKDIR /app/server
ENV HPM_DATA_DIR=/app/data
RUN mkdir -p /app/data

EXPOSE 8080
CMD ["npm", "start"]
