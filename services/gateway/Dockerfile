FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src

COPY shared/Winzy.Contracts/Winzy.Contracts.csproj shared/Winzy.Contracts/
COPY shared/Winzy.Common/Winzy.Common.csproj shared/Winzy.Common/
COPY services/gateway/src/Winzy.Gateway.csproj services/gateway/src/
COPY Directory.Build.props global.json ./
RUN dotnet restore services/gateway/src/Winzy.Gateway.csproj

COPY shared/ shared/
COPY services/gateway/src/ services/gateway/src/
RUN dotnet publish services/gateway/src/Winzy.Gateway.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runtime
WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "Winzy.Gateway.dll"]
