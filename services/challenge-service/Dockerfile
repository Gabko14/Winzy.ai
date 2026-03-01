FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src

COPY shared/Winzy.Contracts/Winzy.Contracts.csproj shared/Winzy.Contracts/
COPY shared/Winzy.Common/Winzy.Common.csproj shared/Winzy.Common/
COPY services/challenge-service/src/Winzy.ChallengeService.csproj services/challenge-service/src/
COPY Directory.Build.props global.json ./
RUN dotnet restore services/challenge-service/src/Winzy.ChallengeService.csproj

COPY shared/ shared/
COPY services/challenge-service/src/ services/challenge-service/src/
RUN dotnet publish services/challenge-service/src/Winzy.ChallengeService.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runtime
WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "Winzy.ChallengeService.dll"]
