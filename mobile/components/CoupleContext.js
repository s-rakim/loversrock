// "Us" state shared across the app: who I am, who my partner is, both moods
// and both wardrobes. Kept live over the socket (mood:update, avatar:update)
// and cached on the device so the loading screen can show the characters
// before the network answers.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch, connectSocket, getAccessToken } from '../services/api';
import { emotionForMood } from './moods';
import { PRESETS } from './avatar/wardrobe';

const CACHE_KEY = 'loversrock_couple_cache';

const CoupleContext = createContext(null);

export async function loadCachedCouple() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Until someone picks their character in the Wardrobe, guess sensibly: if I
// chose one preset, my partner defaults to the other.
function withDefaults(data) {
  if (!data?.me) return data;
  const myPreset = data.me.avatar?.preset || data.me.onboarding?.character || 'him';
  const other = myPreset === 'her' ? 'him' : 'her';
  return {
    ...data,
    me: { ...data.me, avatar: data.me.avatar || PRESETS[myPreset] || PRESETS.him },
    partner: data.partner ? { ...data.partner, avatar: data.partner.avatar || PRESETS[other] } : null,
  };
}

export function characterFor(person) {
  if (!person) return null;
  return {
    name: person.name,
    avatar: person.avatar,
    emotion: emotionForMood(person.mood),
    moodText: person.mood ? `${person.mood.emoji} ${person.mood.text || ''}`.trim() : null,
  };
}

export function CoupleProvider({ children }) {
  const [data, setData] = useState(null);
  const dataRef = useRef(null);
  dataRef.current = data;

  const apply = useCallback((next) => {
    const filled = withDefaults(next);
    setData(filled);
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(filled)).catch(() => {});
  }, []);

  useEffect(() => {
    loadCachedCouple().then((cached) => { if (cached && !dataRef.current) setData(cached); });
  }, []);

  const refresh = useCallback(async () => {
    if (!(await getAccessToken())) return null;
    try {
      const fresh = await apiFetch('/profile/me');
      apply(fresh);
      return fresh;
    } catch {
      return null;
    }
  }, [apply]);

  useEffect(() => { refresh(); }, [refresh]);

  // Live updates from the partner's phone.
  useEffect(() => {
    let socket;
    const onMood = ({ userId, mood }) => {
      const cur = dataRef.current;
      if (!cur) return;
      if (cur.partner?.id === userId) apply({ ...cur, partner: { ...cur.partner, mood } });
      else if (cur.me?.id === userId) apply({ ...cur, me: { ...cur.me, mood } });
    };
    const onAvatar = ({ userId, avatar }) => {
      const cur = dataRef.current;
      if (cur?.partner?.id === userId) apply({ ...cur, partner: { ...cur.partner, avatar } });
    };
    getAccessToken().then((token) => {
      if (!token) return;
      connectSocket().then((s) => {
        socket = s;
        s.on('mood:update', onMood);
        s.on('avatar:update', onAvatar);
      }).catch(() => {});
    });
    return () => {
      socket?.off('mood:update', onMood);
      socket?.off('avatar:update', onAvatar);
    };
  }, [data?.pair?.id, apply]);

  const setMyMood = useCallback(async (emoji, text) => {
    const { mood } = await apiFetch('/profile/mood', { method: 'POST', body: { emoji, text } });
    const cur = dataRef.current;
    if (cur) apply({ ...cur, me: { ...cur.me, mood } });
    return mood;
  }, [apply]);

  const saveAvatar = useCallback(async (avatar) => {
    const { me } = await apiFetch('/profile', { method: 'PATCH', body: { avatar } });
    const cur = dataRef.current;
    if (cur) apply({ ...cur, me: { ...cur.me, avatar: me.avatar } });
  }, [apply]);

  const value = useMemo(() => ({
    me: data?.me || null,
    partner: data?.partner || null,
    pair: data?.pair || null,
    sparks: data?.sparks ?? 0,
    myCharacter: characterFor(data?.me),
    partnerCharacter: characterFor(data?.partner),
    refresh,
    setMyMood,
    saveAvatar,
    clear: () => { setData(null); AsyncStorage.removeItem(CACHE_KEY).catch(() => {}); },
  }), [data, refresh, setMyMood, saveAvatar]);

  return <CoupleContext.Provider value={value}>{children}</CoupleContext.Provider>;
}

export function useCouple() {
  return useContext(CoupleContext) || {
    me: null, partner: null, pair: null, sparks: 0, myCharacter: null, partnerCharacter: null,
    refresh: async () => null, setMyMood: async () => null, saveAvatar: async () => null, clear: () => {},
  };
}
