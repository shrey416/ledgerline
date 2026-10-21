FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY Analytics.csproj .
RUN dotnet restore
COPY Program.cs .
RUN dotnet publish -c Release -o /out --no-restore
FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /out .
ENV ASPNETCORE_HTTP_PORTS=8080
USER 10001
EXPOSE 8080
ENTRYPOINT ["dotnet","Analytics.dll"]
