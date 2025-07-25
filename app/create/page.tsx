"use client";

import { useState } from "react";
import EmotionInput from "../../components/emotionInput";
import SongResults from "../../components/songResults";
import CardCreator from "../../components/cardCreator";
import { Navbar } from "@/components/navbar";
import { extractSongsAsJson } from "@/lib/utils";
import { Song } from "@/types/song";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { SupabaseClient } from "@supabase/supabase-js";

type Step = "input" | "results" | "create" | "loading" | "result";

type SpotifyTrack = {
  id: string;
  title: string;
  artist: string;
  image: string;
  preview_url: string | null;
  spotify_url: string;
};

// 曲名・アーティスト名の正規化関数
function normalize(str: string): string {
  return str
    .toLowerCase()
    .replace(/[\s　]+/g, "") // 全角・半角スペース除去
    .replace(/[‐‑‒–—―ー−]/g, "-") // ダッシュ類を統一
    .replace(/[！!]/g, "!") // 記号例
    .normalize("NFKC"); // 全角半角正規化
}

// 配列シャッフル関数
function shuffleArray<T>(array: T[]): T[] {
  return array
    .map((value) => ({ value, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ value }) => value);
}

export default function Create() {
  const [step, setStep] = useState<Step>("input");
  const [emotion, setEmotion] = useState<string>("");

  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  // 表示済み曲のキー履歴を管理
  const [shownSongKeys, setShownSongKeys] = useState<string[]>([]);
  // 現在表示中の曲を保持
  const [currentDisplaySongs, setCurrentDisplaySongs] = useState<Song[]>([]);

  // 曲の一意キーを生成
  function getSongKey(song: Song) {
    return `${song.title}-${song.artist}`;
  }

  const handleEmotionSubmit = async (
    analyzeResult: string,
    userEmotion: string
  ) => {
    setEmotion(userEmotion);
    setStep("results");
    let songList: Song[] = [];
    try {
      songList = JSON.parse(analyzeResult);
      if (!Array.isArray(songList)) {
        songList = extractSongsAsJson(analyzeResult) as Song[];
      }
    } catch {
      songList = extractSongsAsJson(analyzeResult) as Song[];
    }

    // シャッフル処理を追加
    songList = shuffleArray(songList);

    // 表示済みでない曲を優先して抽出
    const newSongs = songList.filter(
      (song) => !shownSongKeys.includes(getSongKey(song))
    );
    let displaySongs: Song[] = [];
    if (newSongs.length > 0) {
      displaySongs = newSongs.slice(0, 5); // 例: 最大5曲表示
    } else {
      // すべて履歴に含まれている場合はリセットして再度シャッフル
      displaySongs = shuffleArray(songList).slice(0, 5);
      setShownSongKeys([]); // 履歴リセット
    }

    // Spotify APIで画像URLを取得して上書き
    // Spotify APIで画像URLを取得して上書き＋YouTube videoIdを追加
    const updatedSongs: Song[] = [];

    for (const song of displaySongs) {
      try {
        const res = await fetch("/api/search-songs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword: `${song.title} ${song.artist}` }),
        });
        const data = await res.json();

        let matchedTrack: SpotifyTrack | null = null;
        if (data.tracks && data.tracks.length > 0) {
          matchedTrack = data.tracks.find(
            (track: SpotifyTrack) =>
              normalize(track.title) === normalize(song.title) &&
              normalize(track.artist) === normalize(song.artist)
          );
          if (!matchedTrack) {
            matchedTrack = data.tracks.find(
              (track: SpotifyTrack) =>
                normalize(track.title) === normalize(song.title) &&
                normalize(track.artist).includes(normalize(song.artist))
            );
          }
          if (!matchedTrack) matchedTrack = data.tracks[0];
        }

        // YouTube動画ID取得
        let youtubeVideoId: string | undefined = undefined;
        try {
          const ytRes = await fetch("/api/youtube-search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: `${song.title} ${song.artist} official audio`,
            }),
          });
          const ytData = await ytRes.json();
          youtubeVideoId = ytData.videoId;
        } catch (e) {
          console.warn("YouTube API error:", e);
        }

        updatedSongs.push({
          ...song,
          image: matchedTrack?.image || song.image,
          preview_url: matchedTrack?.preview_url || undefined,
          spotify_url: matchedTrack?.spotify_url,
          id: matchedTrack?.id ? parseInt(matchedTrack.id) : undefined,
          youtubeVideoId,
        });
      } catch {
        updatedSongs.push(song);
      }
    }

    // 履歴を更新
    setShownSongKeys((prev) => [...prev, ...updatedSongs.map(getSongKey)]);
    setSongs(updatedSongs);
    setCurrentDisplaySongs(updatedSongs);
    setSelectedSong(null);
    console.log("updatedSongs:", updatedSongs);
  };

  const handleSongSelect = async (song: Song) => {
    // Spotify APIでプレビューURLとSpotifyリンクを取得
    let preview_url = undefined;
    let spotify_url = undefined;
    try {
      const res = await fetch("/api/search-songs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: `${song.title} ${song.artist}` }),
      });
      const data = await res.json();
      if (data.tracks && data.tracks.length > 0) {
        console.log("Spotify track data:", data.tracks[0]);
        preview_url = data.tracks[0].preview_url;
        spotify_url = data.tracks[0].spotify_url;
      }
    } catch {}
    setSelectedSong({ ...song, preview_url, spotify_url, id: song.id });
    setStep("create");

    // --- 履歴を保存 ---
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.warn("ユーザーがログインしていません");
        return;
      }

      // emotionが空の場合は"未入力"で補完
      let saveEmotion = emotion;
      if (!saveEmotion) saveEmotion = "未入力";

      const historyData = {
        user_id: user.id,
        emotion: saveEmotion,
        songTitle: song.title,
        songArtist: song.artist,
        songImageUrl: song.image,
        spotifyUrl: song.spotify_url || spotify_url,
      };

      console.log("保存する履歴データ:", historyData);

      const response = await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(historyData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("履歴保存エラー:", errorData);
        throw new Error(`履歴の保存に失敗しました: ${errorData.error}`);
      }

      console.log("履歴の保存に成功しました");
    } catch (e) {
      console.error("履歴保存エラー:", e);
    }
  };

  const handleRetry = async () => {
    if (!emotion) return;
    setStep("loading");
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: emotion }),
    });
    const data = await response.json();
    await handleEmotionSubmit(data.keywords, emotion);
  };

  const renderStep = () => {
    switch (step) {
      case "input":
        return (
          <EmotionInput
            onSubmit={(result, userEmotion) =>
              handleEmotionSubmit(result, userEmotion)
            }
          />
        );
      case "results":
        return (
          <SongResults
            songs={songs}
            onSelect={handleSongSelect}
            emotion={emotion}
            onRetry={handleRetry}
          />
        );
      case "create":
        return selectedSong ? (
          <CardCreator
            song={{
              ...selectedSong,
              id: selectedSong.id ? String(selectedSong.id) : undefined, // ← 型変換
            }}
            emotion={emotion}
          />
        ) : null;
      case "loading":
        return (
          <div className="min-h-screen bg-gradient-to-b from-pink-50 to-purple-50 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-purple-500 mx-auto mb-4"/>
              <p className="text-purple-600 text-lg font-medium">曲を探しています...</p>
            </div>
          </div>
        );
      case "result":
        return (
          <EmotionInput
            onSubmit={(result, userEmotion) =>
              handleEmotionSubmit(result, userEmotion)
            }
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-pink-50 to-purple-50">
      <Navbar />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-center mb-8">
            <div className="flex items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center cursor-pointer ${
                  step === "input"
                    ? "bg-pink-500 text-white"
                    : "bg-pink-200 text-pink-700"
                }`}
                onClick={() => setStep("input")}
              >
                1
              </div>
              <div
                className={`w-20 h-1 ${
                  step === "input" ? "bg-pink-200" : "bg-pink-500"
                }`}
              ></div>
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  step === "results" || step === "create"
                    ? "bg-pink-500 text-white"
                    : "bg-pink-200 text-pink-700"
                } ${
                  emotion ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                }`}
                onClick={() => {
                  if (emotion) {
                    if (currentDisplaySongs.length > 0) setSongs(currentDisplaySongs);
                    setStep("results");
                  }
                }}
              >
                2
              </div>
              <div
                className={`w-20 h-1 ${
                  step === "create" ? "bg-pink-500" : "bg-pink-200"
                }`}
              ></div>
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  step === "create"
                    ? "bg-pink-500 text-white"
                    : "bg-pink-200 text-pink-700"
                } ${
                  emotion ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                }`}
                onClick={() => {
                  if (emotion) setStep("create");
                }}
              >
                3
              </div>
            </div>
          </div>
          <div className="relative">
            {step !== "loading" && (
              <div>
                {renderStep()}
              </div>
            )}
            {step === "loading" && (
              <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[9999]">
                <div className="bg-white rounded-2xl shadow-xl px-10 py-8 flex flex-col items-center">
                  <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-purple-500 mb-4"/>
                  <p className="text-purple-600 text-lg font-medium">曲を探しています...</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
