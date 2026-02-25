# Project Vision

## Problem
Getting accountability for daily habits is socially awkward. Asking someone "will you be my accountability partner?" creates friction and feels weird. As a result, most people track habits in isolation, missing out on the support and motivation that comes from their social circle.

## Target User
Self-improvement oriented people who already use habit trackers. They understand the value of consistent habits and accountability, but want a more natural way to get social support without the awkwardness of explicitly asking for it.

## Success Metric
Users who connect with friends have higher habit consistency than solo users. The primary social mechanism is **passive accountability** — simply knowing a friend can see your Flame changes behavior.

## Why Software?
A standalone habit tracker with an optional social layer removes friction that manual accountability creates. Instead of texting updates or formally asking for accountability partners, users simply share their tracker with friends who can passively observe or actively support. The social connection happens naturally within the tool they already use daily.

---

## Core Philosophy
- **Habit tracker first**: Works beautifully as a standalone minimalistic tracker. No friends required.
- **Passive accountability**: The core social value is that a friend can *see your Flame*. You don't need to do anything — just knowing someone can see whether your flame is burning or flickering changes behavior. No messages, no nudges, no pressure.
- **Zero-friction sharing**: Your accountability partner doesn't need an account. They just need a link. Every user gets a public flame page (`winzy.ai/@username`) — share it with anyone, embed it anywhere. The friend who never signs up is still an accountability partner.
- **Social layer is optional**: Friends can see your progress and set challenges, but it's an enhancement, not a dependency.
- **Reduce friction, don't add features**: The value is making accountability natural, not adding gamification.
- **Shared experiences, not transactions**: Challenge rewards are things you do TOGETHER (play tennis, grab coffee, go hiking) — not gifts one person gives another. The reward IS the connection.

## Design Principles
- **Clean and minimal**: Pleasant to look at, not confusing. Not childish (Habitica), not corporate. A tool that feels calm.
- **Encourage, never punish**: No guilt-tripping language. Missing a day is OK. The app celebrates progress, not perfection.
- **Consistency over streaks**: Streaks create all-or-nothing anxiety. We measure consistency over a 60-day rolling window — progress you can feel good about even when imperfect.
- **The Flame**: The heart of Winzy.ai. Visual representation of consistency — a small ember at 0%, growing to a blazing flame at 100%. It grows quickly with improvement, shrinks slowly with misses. You're never "at zero" — even a tiny ember means you're still here. The Flame is what friends see. The Flame is the accountability.
- **Supportive notifications**: "Ready to log today?" not "You haven't logged today!" The tone is a supportive friend, not a disappointed parent.

## Product Strategy
- **Web-first MVP**: Ship a web app to validate the concept quickly. Mobile-first responsive design — optimized for phones, works on desktop.
- **PWA**: "Add to Home Screen" for a native-like experience without app stores.
- **Native apps later**: iOS/Android only after the web MVP proves people want this.
- **Same codebase**: Using Expo so the web code can become native mobile apps with minimal changes.
