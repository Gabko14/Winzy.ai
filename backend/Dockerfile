# syntax=docker/dockerfile:1

FROM golang:1.26-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

# distroless/static includes ca-certificates (needed for sslmode=require
# against Railway Postgres) and a non-root "nonroot" user, with no shell —
# nothing our statically linked binary needs is missing.
FROM gcr.io/distroless/static-debian12:nonroot AS final
COPY --from=build /out/api /app/api

EXPOSE 8080
ENTRYPOINT ["/app/api"]
