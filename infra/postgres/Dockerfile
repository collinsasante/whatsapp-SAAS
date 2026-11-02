# syntax=docker/dockerfile:1
#
# PostgreSQL 16 on Alpine with the pgvector extension added.
#
# This is the SAME base image the stack already runs (postgres:16-alpine), with one extension compiled in. Nothing else changes: same
# PostgreSQL major version (16), same data directory layout and user, same musl libc and therefore the same text-collation behaviour,
# so an existing data volume mounts unchanged. pgvector is installed but NOT enabled in any database until someone runs
# `CREATE EXTENSION vector` (the application does not do this at start-up).
#
# Pin PG_IMAGE to the exact minor version the running database uses (check with `docker exec <postgres container> postgres --version`),
# e.g. --build-arg PG_IMAGE=postgres:16.9-alpine, so swapping the image is a no-op for the server itself.
ARG PG_IMAGE=postgres:16-alpine

FROM ${PG_IMAGE} AS build
ARG PGVECTOR_VERSION=v0.8.7
# OPTFLAGS="" matters: pgvector defaults to -march=native, which would tie the binary to the CPU of the machine that built it and can
# crash with "illegal instruction" on another host. with_llvm=no skips the optional JIT bitcode so no clang/llvm build deps are needed.
RUN apk add --no-cache --virtual .build-deps build-base git \
 && git clone --branch "${PGVECTOR_VERSION}" --depth 1 https://github.com/pgvector/pgvector.git /tmp/pgvector \
 && cd /tmp/pgvector \
 && make OPTFLAGS="" with_llvm=no \
 && make install DESTDIR=/out with_llvm=no

FROM ${PG_IMAGE}
COPY --from=build /out/usr/local/ /usr/local/
