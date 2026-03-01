FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src

COPY shared/Winzy.Contracts/Winzy.Contracts.csproj shared/Winzy.Contracts/
COPY shared/Winzy.Common/Winzy.Common.csproj shared/Winzy.Common/
COPY services/auth-service/src/Winzy.AuthService.csproj services/auth-service/src/
COPY Directory.Build.props .
RUN dotnet restore services/auth-service/src/Winzy.AuthService.csproj

COPY shared/ shared/
COPY services/auth-service/src/ services/auth-service/src/
RUN dotnet publish services/auth-service/src/Winzy.AuthService.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runtime
WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "Winzy.AuthService.dll"]
