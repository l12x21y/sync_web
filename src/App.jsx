import { useRoom } from './useRoom.js'
import Home from './screens/Home.jsx'
import Lobby from './screens/Lobby.jsx'
import Play from './screens/Play.jsx'
import Reveal from './screens/Reveal.jsx'

function Splash() {
  return (
    <div className="screen">
      <div className="cols" style={{ gridTemplateColumns: '1fr' }}>
        <div
          className="pane pane--main pane--main--center"
          style={{ alignItems: 'center', textAlign: 'center' }}
        >
          <span className="brand__en">正在回到座位</span>
          <h1
            className="title"
            style={{ fontSize: 30, letterSpacing: '0.2em', opacity: 0.5, marginTop: 14 }}
          >
            同词相见
          </h1>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const { room, myId, error, booting, isHost, create, join, start, submit, next, again, leave } =
    useRoom()

  let screen
  if (booting) {
    screen = <Splash />
  } else if (!room) {
    screen = <Home onCreate={create} onJoin={join} />
  } else if (room.phase === 'lobby') {
    screen = <Lobby room={room} myId={myId} isHost={isHost} onStart={start} onLeave={leave} />
  } else if (room.phase === 'answering') {
    screen = <Play room={room} myId={myId} onSubmit={submit} onLeave={leave} />
  } else {
    screen = (
      <Reveal room={room} isHost={isHost} onNext={next} onAgain={again} onLeave={leave} />
    )
  }

  return (
    <div className="app">
      <div className="stage" key={room ? `${room.code}:${room.phase}:${room.round}` : 'home'}>
        {screen}
      </div>
      {error ? <div className="toast">{error}</div> : null}
    </div>
  )
}
