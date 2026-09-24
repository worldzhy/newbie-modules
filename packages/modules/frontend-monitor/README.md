# newbie.frontend-monitor

# docker clickhouse V25.12

docker pull clickhouse/clickhouse-server:25.12
docker run -d --name clickhouse-server -p 8123:8123 -p 9000:9000 -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 clickhouse/clickhouse-server:25.12

visit: http://127.0.0.1:8123/play

# docker mongo V4.4.6

docker pull mongo:4.4.6
docker run -d --name mongo-server -p 27017:27017 mongo:4.4.6

# docker redis v6.2.4

docker pull redis:6.2.4
docker run -d --name redis-server -p 6379:6379 redis

# docker pg

docker pull postgres:16
docker run -d --name pgsql-16 -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres
