import { useState } from 'react'
import { signIn } from '../auth'
import './SignIn.css'

export function SignIn() {
  const [waiting, setWaiting] = useState(false)
  return (
    <div className="signin">
      <div className="signin-card">
        <div className="signin-intro">
          <h1 className="signin-title">Sign in to YouTube Music</h1>
          <p className="muted signin-lead">Melo plays your YouTube Music library, playlists and recommendations. You sign in once with your Google account.</p>
        </div>
        <ol className="signin-steps">
          <li>
            <b>1</b>
            <span>Google's own sign-in page opens in a window.</span>
          </li>
          <li>
            <b>2</b>
            <span>Melo keeps the session on this Mac and sends it only to YouTube.</span>
          </li>
          <li>
            <b>3</b>
            <span>Premium is picked up from your account: no ads, high quality audio.</span>
          </li>
        </ol>
        <button
          type="button"
          className="btn primary signin-button"
          disabled={waiting}
          onClick={() => {
            setWaiting(true)
            void signIn().finally(() => setWaiting(false))
          }}
        >
          {waiting ? 'Waiting for Google sign-in' : 'Continue with Google'}
        </button>
      </div>
    </div>
  )
}
