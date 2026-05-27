import { useRef, useState } from "react";
import type { Participant, PartyState } from "@nero/shared";
import type { Flash } from "../App";
import { getErrorMessage, getLimitStats } from "../App";
import { addTrack, searchAudius, searchSpotify, uploadAudio } from "../lib/api";
import type { SearchTrack } from "../lib/api";
import { TrackArtwork } from "./shared/TrackArtwork";

type SourceTab = "audius" | "upload" | "spotify";

interface AddSongModalProps {
  state: PartyState;
  participant: Participant;
  participantToken: string;
  onFlash: (flash: Flash) => void;
  onClose: () => void;
}

export function AddSongModal({
  state,
  participant,
  participantToken,
  onFlash,
  onClose,
}: AddSongModalProps) {
  const { allowAudius, allowUploads, allowSpotify } = state.party.settings;
  const defaultTab: SourceTab = allowAudius ? "audius" : allowUploads ? "upload" : "spotify";
  const [tab, setTab] = useState<SourceTab>(defaultTab);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadArtist, setUploadArtist] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const limits = getLimitStats(state, participant.id);
  const queuePos = state.tracks.filter((t) => t.status === "queued").length + 1;

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const fn = tab === "audius" ? searchAudius : searchSpotify;
      const res = await fn(query);
      setResults(res.results);
    } catch (err) {
      onFlash({ tone: "bad", message: getErrorMessage(err) });
    } finally {
      setSearching(false);
    }
  }

  async function handleSubmitTrack(track: SearchTrack) {
    setSubmitting(true);
    try {
      await addTrack(state.party.id, { ...track, participantToken });
      onFlash({ tone: "good", message: `"${track.title}" added to queue.` });
      onClose();
    } catch (err) {
      onFlash({ tone: "bad", message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) return;
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("audio", uploadFile);
      form.append("title", uploadTitle || uploadFile.name.replace(/\.[^.]+$/, ""));
      form.append("artist", uploadArtist || participant.displayName);
      const track = await uploadAudio(form);
      await addTrack(state.party.id, { ...track, participantToken });
      onFlash({ tone: "good", message: `"${track.title}" uploaded and queued.` });
      onClose();
    } catch (err) {
      onFlash({ tone: "bad", message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("audio/")) {
      setUploadFile(file);
      if (!uploadTitle) setUploadTitle(file.name.replace(/\.[^.]+$/, ""));
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal add-song-modal">
        {/* Header */}
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Add a song</h2>
            <p className="modal-subtitle">Queue position #{queuePos}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Source tabs */}
        <div className="modal-tabs">
          {allowAudius && (
            <button
              className={`modal-tab ${tab === "audius" ? "modal-tab-active" : ""}`}
              onClick={() => { setTab("audius"); setResults([]); }}
            >
              Audius search
            </button>
          )}
          {allowUploads && (
            <button
              className={`modal-tab ${tab === "upload" ? "modal-tab-active" : ""}`}
              onClick={() => { setTab("upload"); setResults([]); }}
            >
              Upload a track
            </button>
          )}
          {allowSpotify && (
            <button
              className={`modal-tab ${tab === "spotify" ? "modal-tab-active" : ""}`}
              onClick={() => { setTab("spotify"); setResults([]); }}
            >
              Spotify
            </button>
          )}
        </div>

        {/* Content */}
        <div className="modal-body">
          {(tab === "audius" || tab === "spotify") && (
            <>
              <form className="search-bar" onSubmit={handleSearch}>
                <input
                  className="search-input"
                  placeholder="Search for songs, artists, or albums"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                />
                <button className="search-btn" type="submit" disabled={searching}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                </button>
              </form>

              {searching && <div className="search-loading">Searching...</div>}

              {results.length > 0 && (
                <div className="search-results">
                  {results.map((track) => (
                    <button
                      key={`${track.sourceType}-${track.sourceId}`}
                      className="search-result-row"
                      onClick={() => handleSubmitTrack(track)}
                      disabled={submitting}
                    >
                      <TrackArtwork track={track} size="tiny" />
                      <div className="search-result-info">
                        <strong>{track.title}</strong>
                        <span>{track.artist}</span>
                      </div>
                      <span className="search-result-duration">
                        {Math.floor(track.durationSeconds / 60)}:{String(Math.floor(track.durationSeconds % 60)).padStart(2, "0")}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {!searching && results.length === 0 && query && (
                <div className="search-empty">No results found. Try a different query.</div>
              )}
            </>
          )}

          {tab === "upload" && (
            <form className="upload-form" onSubmit={handleUpload}>
              <div
                className="upload-dropzone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
                onClick={() => fileRef.current?.click()}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setUploadFile(f);
                      if (!uploadTitle) setUploadTitle(f.name.replace(/\.[^.]+$/, ""));
                    }
                  }}
                />
                {uploadFile ? (
                  <span className="upload-file-name">{uploadFile.name}</span>
                ) : (
                  <>
                    <UploadIcon />
                    <span>Drag and drop an audio file here</span>
                    <small>or click to browse your device</small>
                  </>
                )}
              </div>

              <div className="upload-fields">
                <div className="upload-field">
                  <label>Title</label>
                  <input
                    className="field"
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    placeholder="Song title"
                  />
                </div>
                <div className="upload-field">
                  <label>Artist</label>
                  <input
                    className="field"
                    value={uploadArtist}
                    onChange={(e) => setUploadArtist(e.target.value)}
                    placeholder="Artist name (optional)"
                  />
                </div>
              </div>

              <button className="modal-cta" type="submit" disabled={!uploadFile || submitting}>
                {submitting ? "Uploading..." : "Add to queue"}
              </button>
            </form>
          )}
        </div>

        {/* Source policy */}
        <div className="modal-policy">
          <PolicyIcon />
          <div>
            <strong>Nero Party is a source-first listening room.</strong>
            <span>Add music you own or have permission to share. Respect the artists.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg className="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
    </svg>
  );
}

function PolicyIcon() {
  return (
    <svg className="policy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
