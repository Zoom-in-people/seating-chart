import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Draggable from 'react-draggable';
import html2canvas from 'html2canvas';
import { db } from './firebase';
import { ref, onValue, set, update } from "firebase/database";
import './App.css';

// --- 무작위 별명 생성기 ---
const adjectives = ['붉은', '푸른', '춤추는', '용감한', '날쌘', '지혜로운', '신비한', '고독한', '즐거운', '빛나는'];
const nouns = ['매', '늑대', '호랑이', '사자', '독수리', '돌고래', '거북이', '고양이', '강아지', '여우'];
const generateNickname = () => `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;

// ==========================================
// 1. 선생님용 메인 화면 (드래그 저장 기능 복구)
// ==========================================
function TeacherView() {
  const [studentInput, setStudentInput] = useState("");
  const [seatCount, setSeatCount] = useState(24);
  const [cols, setCols] = useState(4);
  const [seats, setSeats] = useState([]);
  const [auctionStatus, setAuctionStatus] = useState("waiting");

  const canvasRef = useRef(null);
  const teacherRef = useRef(null);
  const windowRef = useRef(null);
  const aisleRef = useRef(null);

  const scale = Math.min(1.2, 4 / (cols || 1)); 
  const deskWidth = 220 * scale;
  const deskHeight = 150 * scale;
  const gapX = 300 * scale;

  useEffect(() => {
    const dbRef = ref(db, '/');
    onValue(dbRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        if (data.config) {
          setStudentInput(data.config.studentInput || "");
          setSeatCount(data.config.seatCount || 24);
          setCols(data.config.cols || 4);
        }
        if (data.status) setAuctionStatus(data.status);
        
        setSeats(prevSeats => {
          const currentScale = 4 / (data.config?.cols || 4);
          return Array(Number(data.config?.seatCount || 24)).fill(null).map((_, i) => {
            const fbSeat = data.seats && data.seats[i] ? data.seats[i] : { bid: 900, nickname: '', realName: '' };
            const prevSeat = prevSeats.find(s => s.id === i);
            
            return {
              id: i,
              ...fbSeat,
              // DB에 x,y 값이 있으면 가져오고, 없으면 기본 격자로 계산
              x: fbSeat.x !== undefined ? fbSeat.x : (i % (data.config?.cols || 4)) * (300 * currentScale) + 150,
              y: fbSeat.y !== undefined ? fbSeat.y : Math.floor(i / (data.config?.cols || 4)) * (230 * currentScale) + 180,
              // 드래그가 끊기지 않도록 이전 노드 참조(ref) 유지
              nodeRef: prevSeat ? prevSeat.nodeRef : React.createRef()
            };
          });
        });
      }
    });
  }, []);

  const syncConfigToFirebase = (count, columns, input) => {
    update(ref(db, 'config'), { seatCount: Number(count), cols: Number(columns), studentInput: input });
  };

  // [수정됨] 선생님이 책상을 드래그하면 파이어베이스에 x, y 좌표 저장
  const handleStop = (id, e, data) => {
    update(ref(db, `seats/${id}`), { x: data.x, y: data.y });
  };

  // 엉망이 된 위치를 다시 가지런히 정리하고 싶을 때 쓰는 버튼
  const resetPositions = () => {
    if (window.confirm("자리 배치를 기본 격자로 정렬하시겠습니까? (입찰 기록은 유지됩니다)")) {
      const currentScale = 4 / cols;
      const updates = {};
      for (let i = 0; i < seatCount; i++) {
        updates[`seats/${i}/x`] = (i % cols) * (300 * currentScale) + 150;
        updates[`seats/${i}/y`] = Math.floor(i / cols) * (230 * currentScale) + 180;
      }
      update(ref(db), updates);
    }
  };

  // [수정됨] 시작 시 x, y 좌표는 날아가지 않도록 안전하게 업데이트
  const handleStartAuction = () => {
    if (window.confirm("블라인드 경매를 시작합니까? 모든 자리가 900P로 초기화됩니다.")) {
      const updates = {};
      for (let i = 0; i < seatCount; i++) {
        updates[`seats/${i}/bid`] = 900;
        updates[`seats/${i}/nickname`] = '';
        updates[`seats/${i}/realName`] = '';
      }
      updates['status'] = 'active';
      update(ref(db), updates);
    }
  };

  const handleEndAuction = () => {
    if (window.confirm("경매를 종료하고 학생들의 진짜 이름을 공개하시겠습니까?")) {
      set(ref(db, 'status'), 'ended');
    }
  };

  return (
    <div className="App">
      <aside className="sidebar">
        <header className="brand">자리배치 <span>Pro</span></header>
        
        <div className="control-group">
          <label>1. 학생 명단 관리</label>
          <textarea value={studentInput} onChange={(e) => syncConfigToFirebase(seatCount, cols, e.target.value)} placeholder="이름1, 이름2..." rows="8" />
        </div>

        <div className="control-group">
          <label>2. 레이아웃 설정</label>
          <div className="row">
            <div className="col"><span>책상수</span><input type="number" value={seatCount} onChange={(e) => syncConfigToFirebase(e.target.value, cols, studentInput)} /></div>
            <div className="col"><span>열(줄)</span><input type="number" value={cols} onChange={(e) => syncConfigToFirebase(seatCount, e.target.value, studentInput)} /></div>
          </div>
          <button className="btn-reset" onClick={resetPositions}>자리 정렬 초기화</button>
        </div>

        <div className="control-group">
          <label>3. 블라인드 경매 컨트롤</label>
          {auctionStatus !== 'active' ? (
            <button className="btn-auction-start" onClick={handleStartAuction}>🔥 경매 시작 (900P 셋팅)</button>
          ) : (
            <button className="btn-auction-end" onClick={handleEndAuction}>🛑 경매 종료 및 정체 공개!</button>
          )}
          <p className="hint" style={{marginTop:'10px'}}>* 접속 주소: 웹주소/student</p>
        </div>
      </aside>

      <main className="classroom" ref={canvasRef}>
        <Draggable nodeRef={teacherRef} defaultPosition={{x: 600, y: 30}}>
          <div ref={teacherRef} className="object teacher-desk">교 탁</div>
        </Draggable>

        {seats.map((seat) => (
          <Draggable 
            key={seat.id} 
            nodeRef={seat.nodeRef} 
            position={{x: seat.x, y: seat.y}}
            onStop={(e, data) => handleStop(seat.id, e, data)} /* 드래그 저장 추가 */
          >
            <div ref={seat.nodeRef} className={`desk ${seat.bid > 900 ? 'active' : ''}`} style={{ width: `${deskWidth}px`, height: `${deskHeight}px`, padding: `${15 * scale}px`, borderRadius: `${20 * scale}px` }}>
              <header style={{ fontSize: `${0.8 * scale}rem`, marginBottom: `${8 * scale}px` }}>
                좌석 #{seat.id + 1}
              </header>
              <div className="details" style={{justifyContent: 'center'}}>
                <div className="name-tag" style={{ fontSize: `${1.8 * scale}rem`, color: auctionStatus === 'ended' ? '#e11d48' : '#1e293b' }}>
                  {seat.bid === 900 ? "빈 자리" : (auctionStatus === 'ended' ? seat.realName : seat.nickname)}
                </div>
                <div className="score-box" style={{ fontSize: `${1.1 * scale}rem`, width: '100%', marginTop: `${15 * scale}px` }}>
                  {seat.bid} P
                </div>
              </div>
            </div>
          </Draggable>
        ))}
      </main>
    </div>
  );
}

// ==========================================
// 2. 학생용 스마트폰 화면 (+ 금액 선택 팝업)
// ==========================================
function StudentView() {
  const [realName, setRealName] = useState("");
  const [nickname, setNickname] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  
  const [seats, setSeats] = useState([]);
  const [cols, setCols] = useState(4);
  const [auctionStatus, setAuctionStatus] = useState("waiting");
  
  // 학생들이 터치한 좌석의 입찰 팝업 상태
  const [biddingSeat, setBiddingSeat] = useState(null);

  useEffect(() => {
    const savedName = localStorage.getItem('student_realName');
    const savedNick = localStorage.getItem('student_nickname');
    if (savedName && savedNick) {
      setRealName(savedName);
      setNickname(savedNick);
      setIsJoined(true);
    }

    const dbRef = ref(db, '/');
    onValue(dbRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        if (data.config) setCols(data.config.cols || 4);
        if (data.status) setAuctionStatus(data.status);
        if (data.seats) {
          const seatsArr = Object.keys(data.seats).map(key => ({ id: Number(key), ...data.seats[key] }));
          setSeats(seatsArr);
        }
      }
    });
  }, []);

  const handleJoin = () => {
    if (!realName.trim()) return alert("이름을 입력해주세요!");
    const newNick = generateNickname();
    setNickname(newNick);
    setIsJoined(true);
    localStorage.setItem('student_realName', realName);
    localStorage.setItem('student_nickname', newNick);
    alert(`환영합니다! 당신의 암호명은 [${newNick}] 입니다.`);
  };

  // 자리를 터치하면 팝업 열기
  const openBidModal = (seat) => {
    if (auctionStatus !== 'active') return alert("현재 경매 진행 중이 아닙니다.");
    setBiddingSeat(seat);
  };

  // 선택한 금액만큼 입찰 확정!
  const submitBid = (amount) => {
    const currentBid = biddingSeat.bid === 900 ? 900 : biddingSeat.bid;
    const nextBid = currentBid + amount;
    
    update(ref(db, `seats/${biddingSeat.id}`), {
      bid: nextBid,
      nickname: nickname,
      realName: realName
    });
    setBiddingSeat(null); // 입찰 후 팝업 닫기
  };

  if (!isJoined) {
    return (
      <div className="student-login">
        <h2>블라인드 자리 경매</h2>
        <input type="text" placeholder="본인 실명 입력 (예: 김철수)" value={realName} onChange={e => setRealName(e.target.value)} />
        <button onClick={handleJoin}>입장하기 (암호명 발급)</button>
      </div>
    );
  }

  return (
    <div className="student-app">
      <div className="student-header">
        <div>내 암호명: <strong>{nickname}</strong></div>
        <div className="status-badge">
          {auctionStatus === 'waiting' ? '대기중' : auctionStatus === 'active' ? '🔥 경매 진행중' : '🛑 종료됨'}
        </div>
      </div>
      
      <div className="student-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {seats.map((seat) => (
          <div key={seat.id} className={`student-desk ${seat.nickname === nickname ? 'my-seat' : ''}`} onClick={() => openBidModal(seat)}>
            <div className="s-desk-num">#{seat.id + 1}</div>
            <div className="s-desk-name">
               {seat.bid === 900 ? "입찰가능" : (auctionStatus === 'ended' ? seat.realName : seat.nickname)}
            </div>
            <div className="s-desk-bid">{seat.bid}P</div>
          </div>
        ))}
      </div>

      {/* --- 학생 입찰용 팝업 모달 --- */}
      {biddingSeat && (
        <div className="auction-overlay">
          <div className="auction-modal" style={{ width: '90%', maxWidth: '400px', padding: '1.5rem' }}>
            <h2 className="auction-title">🪑 좌석 #{biddingSeat.id + 1} 입찰</h2>
            
            <div className="bid-section" style={{ padding: '1rem' }}>
              <span className="bid-label">현재 자리의 입찰가</span>
              <div className="bid-amount" style={{ fontSize: '2.5rem' }}>{biddingSeat.bid} P</div>
              
              <div className="bid-controls" style={{ marginTop: '15px' }}>
                <button onClick={() => submitBid(100)}>+ 100</button>
                <button onClick={() => submitBid(500)}>+ 500</button>
                <button onClick={() => submitBid(1000)}>+ 1000</button>
              </div>
            </div>

            <button className="btn-close-auction" style={{ background: '#94a3b8', padding: '12px', marginTop: '10px' }} onClick={() => setBiddingSeat(null)}>
              취소 / 닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TeacherView />} />
        <Route path="/student" element={<StudentView />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;