FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod .
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 go build -mod=mod -trimpath -o /rates .
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /rates /rates
EXPOSE 8080
ENTRYPOINT ["/rates"]
