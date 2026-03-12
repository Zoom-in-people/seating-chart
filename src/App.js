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
// 1. 선생님용 메인 화면
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
              x: fbSeat.x !== undefined ? fbSeat.x : (i % (data.config?.cols || 4)) * (300 * currentScale) + 150,
              y: fbSeat.y !== undefined ? fbSeat.y : Math.floor(i / (data.config?.cols || 4)) * (230 * currentScale) + 180,
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

  const handleStop = (id, e, data) => {
    update(ref(db, `seats/${id}`), { x: data.x, y: data.y });
  };

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

  // [수정됨] 하단 여백을 대폭 늘려서 글자 잘림 현상 완벽 해결!
  const handleExportImage = () => {
    const container = canvasRef.current;
    if (!container) return;

    const elements = container.querySelectorAll('.teacher-desk, .desk');
    if (elements.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const containerRect = container.getBoundingClientRect();

    elements.forEach(el => {
      const rect = el.getBoundingClientRect();
      const x = rect.left - containerRect.left + container.scrollLeft;
      const y = rect.top - containerRect.top + container.scrollTop;
      
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + rect.width > maxX) maxX = x + rect.width;
      if (y + rect.height > maxY) maxY = y + rect.height;
    });

    // 상좌우는 50px, 하단은 150px로 여유롭게 설정
    const paddingX = 50;
    const paddingTop = 50;
    const paddingBottom = 150; 

    html2canvas(container, {
      x: minX - paddingX,
      y: minY - paddingTop,
      width: (maxX - minX) + (paddingX * 2),
      height: (maxY - minY) + paddingTop + paddingBottom,
      backgroundColor: '#f8fafc',
      scale: 2 
    }).then(canvas => {
      const a = document.createElement('a');
      a.download = '2-5반_자리배치도_완성.png';
      a.href = canvas.toDataURL('image/png');
      a.click();
    });
  };

  return (
    <div className="App">
      <aside className="sidebar" style={{ display: 'flex', flexDirection: 'column' }}>
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

        <footer className="footer-actions" style={{ marginTop: 'auto' }}>
          <button 
            onClick={handleExportImage} 
            style={{ width: '100%', padding: '16px', background: '#1e293b', color: 'white', border: 'none', borderRadius: '12px', fontSize: '1.1rem', fontWeight: '800', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
          >
            📸 자리배치도 꽉 차게 저장
          </button>
        </footer>
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
            onStop={(e, data) => handleStop(seat.id, e, data)}
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
// 2. 학생용 스마트폰 화면
// ==========================================
function StudentView() {
  const [realName, setRealName] = useState("");
  const [nickname, setNickname] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  
  const [seats, setSeats] = useState([]);
  const [cols, setCols] = useState(4);
  const [auctionStatus, setAuctionStatus] = useState("waiting");
  
  const [biddingSeat, setBiddingSeat] = useState(null);
  const [tempBid, setTempBid] = useState(0);
  const [myPoints, setMyPoints] = useState(0);

  // 🚨 여기에 선생님의 실제 Stein API URL을 넣어주세요! (맨 끝이 status 여야 합니다)
  const STEIN_URL = "https://api.steinhq.com/v1/storages/69a6fb04affba40a625861dd/status";

  const fetchMyPoints = async (name) => {
    try {
      const response = await fetch(STEIN_URL);
      const data = await response.json();
      
      const studentData = data.find(row => row["이름"] === name);
      
      if (studentData) {
        setMyPoints(Number(studentData["잔액"]));
      } else {
        console.warn("명단에 없는 이름이거나 포인트 데이터가 없습니다.");
        setMyPoints(0);
      }
    } catch (error) {
      console.error("포인트를 불러오는데 실패했습니다.", error);
    }
  };

  useEffect(() => {
    const savedName = localStorage.getItem('student_realName');
    const savedNick = localStorage.getItem('student_nickname');
    if (savedName && savedNick) {
      setRealName(savedName);
      setNickname(savedNick);
      setIsJoined(true);
      fetchMyPoints(savedName);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleJoin = () => {
    if (!realName.trim()) return alert("이름을 입력해주세요!");
    const newNick = generateNickname();
    setNickname(newNick);
    setIsJoined(true);
    localStorage.setItem('student_realName', realName);
    localStorage.setItem('student_nickname', newNick);
    
    fetchMyPoints(realName);
    alert(`환영합니다! 당신의 암호명은 [${newNick}] 입니다.`);
  };

  const handleLogout = () => {
    if (window.confirm("로그아웃 하시겠습니까? (현재 입찰 기록은 유지됩니다)")) {
      localStorage.removeItem('student_realName');
      localStorage.removeItem('student_nickname');
      setRealName("");
      setNickname("");
      setMyPoints(0);
      setIsJoined(false);
    }
  };

  const openBidModal = (seat) => {
    if (auctionStatus !== 'active') return alert("현재 경매 진행 중이 아닙니다.");
    setBiddingSeat(seat);
    setTempBid(seat.bid === 900 ? 1000 : seat.bid + 100);
  };

  const confirmBid = () => {
    if (tempBid <= biddingSeat.bid && biddingSeat.bid !== 900) {
      return alert("현재 입찰가보다 높은 금액을 제시해야 합니다!");
    }
    
    if (tempBid > myPoints) {
      return alert(`보유 포인트가 부족합니다! (현재 잔여: ${myPoints}P)`);
    }

    const updates = {};

    seats.forEach(seat => {
      if (seat.nickname === nickname && seat.id !== biddingSeat.id) {
        updates[`seats/${seat.id}/bid`] = 900;
        updates[`seats/${seat.id}/nickname`] = '';
        updates[`seats/${seat.id}/realName`] = '';
      }
    });

    updates[`seats/${biddingSeat.id}/bid`] = tempBid;
    updates[`seats/${biddingSeat.id}/nickname`] = nickname;
    updates[`seats/${biddingSeat.id}/realName`] = realName;

    update(ref(db), updates);
    setBiddingSeat(null); 
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
      <div className="student-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ lineHeight: '1.4' }}>
          <div>내 암호명: <strong>{nickname}</strong></div>
          <div style={{ fontSize: '0.85rem', color: '#fbbf24' }}>💰 잔여 포인트: {myPoints.toLocaleString()}P</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
          <div className="status-badge">
            {auctionStatus === 'waiting' ? '대기중' : auctionStatus === 'active' ? '🔥 진행중' : '🛑 종료됨'}
          </div>
          <button onClick={handleLogout} style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #94a3b8', borderRadius: '6px', fontSize: '0.75rem', padding: '4px 8px', cursor: 'pointer' }}>
            로그아웃
          </button>
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

      {biddingSeat && (
        <div className="auction-overlay">
          <div className="auction-modal" style={{ width: '90%', maxWidth: '400px', padding: '1.5rem', textAlign: 'center' }}>
            <h2 className="auction-title">🪑 좌석 #{biddingSeat.id + 1} 입찰</h2>
            <p style={{fontSize: '0.85rem', color: '#64748b', marginTop: '5px'}}>다른 자리를 선택하면 기존 입찰은 취소됩니다.</p>
            
            <div className="bid-section" style={{ padding: '1rem', marginTop: '10px' }}>
              <span className="bid-label">내가 베팅할 금액 (보유: {myPoints}P)</span>
              
              <div className="bid-amount" style={{ fontSize: '3rem', color: tempBid > myPoints ? '#ef4444' : '#4f46e5', fontWeight: '900' }}>
                {tempBid} P
              </div>
              
              <div className="bid-controls" style={{ marginTop: '15px', display: 'flex', gap: '8px', justifyContent: 'center' }}>
                <button onClick={() => setTempBid(p => p + 100)} style={{ flex: 1, padding: '10px', fontSize: '1rem' }}>+ 100</button>
                <button onClick={() => setTempBid(p => p + 500)} style={{ flex: 1, padding: '10px', fontSize: '1rem' }}>+ 500</button>
                <button onClick={() => setTempBid(p => p + 1000)} style={{ flex: 1, padding: '10px', fontSize: '1rem' }}>+ 1000</button>
              </div>
              
              <button onClick={() => setTempBid(biddingSeat.bid === 900 ? 1000 : biddingSeat.bid + 100)} style={{ marginTop: '10px', border: 'none', background: 'transparent', color: '#64748b', textDecoration: 'underline', cursor: 'pointer' }}>
                금액 다시 입력하기
              </button>
            </div>

            <button onClick={confirmBid} style={{ width: '100%', padding: '16px', background: tempBid > myPoints ? '#94a3b8' : '#4f46e5', color: 'white', border: 'none', borderRadius: '12px', fontSize: '1.2rem', fontWeight: '800', marginTop: '15px', cursor: tempBid > myPoints ? 'not-allowed' : 'pointer' }}>
              {tempBid > myPoints ? "포인트 부족 🚫" : `✅ ${tempBid}P로 입찰 확정!`}
            </button>
            
            <button className="btn-close-auction" style={{ background: '#cbd5e1', color: '#334155', padding: '12px', marginTop: '10px', width: '100%', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: '700', cursor: 'pointer' }} onClick={() => setBiddingSeat(null)}>
              취소
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