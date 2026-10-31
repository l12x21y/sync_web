import { useRoom } from './useRoom.js'
import Home from './screens/Home.jsx'
import Lobby from './screens/Lobby.jsx'
import Play from './screens/Play.jsx'
import Reveal from './screens/Reveal.jsx'
import Bubbles from './components/Bubbles.jsx'
import ChatBar from './components/ChatBar.jsx'

function Splash() {
  return (
    <div className="screen">
      <div className="cols" style={{ gridTemplateColumns: '1fr' }}>
        <div
          className="pane pane--main pane--main--center"
          style={{ alignItems: 'center', textAlign: 'center' }}
        >
          <p className="kicker">RECONNECTING</p>
          <h1
            className="title"
            style={{ fontSize: 28, letterSpacing: '0.2em', opacity: 0.55, marginTop: 6 }}
          >
            RESONANCE
          </h1>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const { room, myId, error, booting, isHost, chats, create, join, start, submit, next, again, updateSettings, sendChat, dropChat, leave } =
    useRoom()

  let screen
  if (booting) {
    screen = <Splash />
  } else if (!room) {
    screen = <Home onCreate={create} onJoin={join} />
  } else if (room.phase === 'lobby') {
    screen = (
      <Lobby
        room={room}
        myId={myId}
        isHost={isHost}
        onStart={start}
        onSettings={updateSettings}
        onLeave={leave}
      />
    )
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
      {room ? (
        <>
          <Bubbles chats={chats} myId={myId} onGone={dropChat} />
          <ChatBar onSend={sendChat} />
        </>
      ) : null}
    </div>
  )
}
