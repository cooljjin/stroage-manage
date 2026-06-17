import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, Link as LinkIcon } from "lucide-react";
import { supabase } from "../lib/supabase";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import type { StaffProfile } from "../types/domain";

type Props = {
  token: string;
  signedIn: boolean;
  onAccepted: (profile: StaffProfile) => void;
  onSignup: (email: string) => void;
};

type PublicInvite = {
  email: string | null;
};

function readPublicInvite(data: unknown): PublicInvite | null {
  if (Array.isArray(data)) {
    return (data[0] as PublicInvite | undefined) ?? null;
  }
  return (data as PublicInvite | null) ?? null;
}

export function InviteAcceptPage({ token, signedIn, onAccepted, onSignup }: Props) {
  const [email, setEmail] = useState("");
  const [currentEmail, setCurrentEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [signupMode, setSignupMode] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadInvite() {
      setInviteLoading(true);
      setError("");
      const { data, error: inviteError } = await supabase.rpc("get_store_invite_public" as never, { invite_token: token } as never);
      const invite = readPublicInvite(data);

      if (cancelled) return;

      if (inviteError) {
        setError(inviteError.message);
      } else if (invite?.email) {
        setEmail(invite.email);
      } else {
        setError("유효하지 않거나 만료된 초대입니다.");
      }

      setInviteLoading(false);
    }

    void loadInvite();

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    let cancelled = false;

    async function loadCurrentUser() {
      if (!signedIn) {
        setCurrentEmail("");
        return;
      }

      const { data } = await supabase.auth.getUser();
      if (!cancelled) {
        setCurrentEmail(data.user?.email ?? "");
      }
    }

    void loadCurrentUser();

    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const signedInWithInviteEmail = signedIn && email && currentEmail.toLowerCase() === email.toLowerCase();
  const showSignupForm = !signedIn || signupMode || (signedIn && email && currentEmail && !signedInWithInviteEmail);

  async function handleSignup(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (password !== confirmPassword) {
      setError("비밀번호가 서로 다릅니다.");
      return;
    }

    setAuthLoading(true);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.href
      }
    });
    if (signUpError) {
      setError(signUpError.message);
    } else if (!data.session) {
      setError("회원가입은 완료됐지만 자동 로그인이 되지 않았습니다. Supabase Email 설정에서 Confirm email이 꺼져 있는지 확인해 주세요.");
    } else {
      setMessage("회원가입이 완료되었습니다. 초대를 수락하는 중입니다.");
      await acceptInvite();
    }

    setAuthLoading(false);
  }

  async function acceptInvite() {
    if (signedIn && !signedInWithInviteEmail) {
      setLoading(true);
      setError("");
      setMessage("");
      await supabase.auth.signOut();
      setSignupMode(true);
      setMessage("초대받은 이메일로 비밀번호를 설정해 주세요.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    const { data, error: acceptError } = await supabase.rpc("accept_store_invite" as never, { invite_token: token } as never);
    if (acceptError) {
      setError(acceptError.message);
    } else if (data) {
      onAccepted(data as StaffProfile);
    }

    setLoading(false);
  }

  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-6 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-xl">
        <PageTitle title="초대 수락" description="초대받은 이메일로 비밀번호를 설정하고 매장 계정을 만듭니다." />
        <div className="panel space-y-4 p-4">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-md bg-brand-600 text-white">
              <LinkIcon size={21} />
            </div>
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
              {inviteLoading ? "초대 정보를 확인하는 중입니다." : "초대 링크가 확인되었습니다."}
            </p>
          </div>
          {error ? <StatusMessage type="error">{error}</StatusMessage> : null}
          {message ? <StatusMessage type="success">{message}</StatusMessage> : null}
          {!showSignupForm ? (
            <button type="button" onClick={() => onSignup(email)} className="primary-button inline-flex w-full items-center justify-center gap-2" disabled={loading || !email}>
              <CheckCircle2 size={19} />
              회원가입
            </button>
          ) : signedIn && !signupMode ? (
            <button type="button" onClick={() => onSignup(email)} className="primary-button inline-flex w-full items-center justify-center gap-2" disabled={loading || inviteLoading || !email}>
              <CheckCircle2 size={19} />
              회원가입
            </button>
          ) : (
            <form onSubmit={handleSignup} className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">초대받은 이메일</span>
                <input className="field" type="email" value={email} readOnly required autoComplete="email" />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">비밀번호</span>
                <input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} autoComplete="new-password" />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">비밀번호 확인</span>
                <input className="field" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={6} autoComplete="new-password" />
              </label>
              <button className="primary-button w-full" type="submit" disabled={authLoading || inviteLoading || !email}>
                {authLoading ? "가입 중..." : "회원가입"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
