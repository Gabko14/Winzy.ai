FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src

COPY shared/Winzy.Contracts/Winzy.Contracts.csproj shared/Winzy.Contracts/
COPY shared/Winzy.Common/Winzy.Common.csproj shared/Winzy.Common/
COPY services/social-service/src/Winzy.SocialService.csproj services/social-service/src/
COPY Directory.Build.props global.json ./
RUN dotnet restore services/social-service/src/Winzy.SocialService.csproj

COPY shared/ shared/
COPY services/social-service/src/ services/social-service/src/
RUN dotnet publish services/social-service/src/Winzy.SocialService.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runtime
WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "Winzy.SocialService.dll"]
