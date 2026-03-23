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

  const scale = Math.min(1.2, 4 / (cols || 1)); 
  const deskWidth = 220 * scale;
  const deskHeight = 150 * scale;

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
    const snappedX = Math.max(150, Math.round((data.x - 150) / (300 * scale)) * (300 * scale) + 150);
    const snappedY = Math.max(180, Math.round((data.y - 180) / (230 * scale)) * (230 * scale) + 180);
    
    update(ref(db, `seats/${id}`), { x: snappedX, y: snappedY });
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

  const handleRandomAssign = () => {
    if (window.confirm("경매에 참여하지 않은 학생들을 빈 자리에 랜덤으로 배치하시겠습니까?")) {
      const allNames = studentInput.split(/[,\n]+/).map(n => n.trim()).filter(n => n);
      const assignedNames = seats.map(s => s.realName).filter(n => n);
      const unassignedNames = allNames.filter(n => !assignedNames.includes(n));
      const emptySeats = seats.filter(s => s.bid === 900 || s.realName === "");

      if (unassignedNames.length === 0) return alert("배치할 남은 학생이 없습니다!");
      if (emptySeats.length === 0) return alert("남은 빈 자리가 없습니다!");

      const shuffled = [...unassignedNames].sort(() => Math.random() - 0.5);
      const updates = {};
      let assignCount = 0;

      for (let i = 0; i < emptySeats.length; i++) {
        if (i < shuffled.length) {
          const seatId = emptySeats[i].id;
          updates[`seats/${seatId}/bid`] = 0; 
          updates[`seats/${seatId}/nickname`] = "🎲 랜덤배치";
          updates[`seats/${seatId}/realName`] = shuffled[i];
          assignCount++;
        }
      }

      if (assignCount > 0) {
        update(ref(db), updates);
        alert(`${assignCount}명의 학생이 빈 자리에 랜덤으로 배치되었습니다!`);
      }
    }
  };

  const handleExportImage = () => {
    const container = canvasRef.current;
    if (!container) return;

    const originalScrollTop = container.scrollTop;
    const originalScrollLeft = container.scrollLeft;
    container.scrollTop = 0;
    container.scrollLeft = 0;

    const elements = container.querySelectorAll('.teacher-desk, .desk');
    if (elements.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const containerRect = container.getBoundingClientRect();

    elements.forEach(el => {
      const rect = el.getBoundingClientRect();
      const x = rect.left - containerRect.left;
      const y = rect.top - containerRect.top;
      
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + rect.width > maxX) maxX = x + rect.width;
      if (y + rect.height > maxY) maxY = y + rect.height;
    });

    const paddingX = 50;
    const paddingTop = 50;
    const paddingBottom = 150; 

    const originalOverflow = container.style.overflow;
    const originalHeight = container.style.height;
    
    container.style.overflow = 'visible';
    container.style.height = `${maxY + paddingBottom}px`;

    html2canvas(container, {
      x: minX - paddingX,
      y: minY - paddingTop,
      width: (maxX - minX) + (paddingX * 2),
      height: (maxY - minY) + paddingTop + paddingBottom,
      backgroundColor: '#f8fafc',
      scale: 2 
    }).then(canvas => {
      container.style.overflow = originalOverflow;
      container.style.height = originalHeight;
      container.scrollTop = originalScrollTop;
      container.scrollLeft = originalScrollLeft;

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
          
          <button 
            onClick={handleRandomAssign} 
            style={{ width: '100%', padding: '16px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: '12px', fontSize: '1.1rem', fontWeight: '800', cursor: 'pointer', boxShadow: '0 4px 12px rgba(139, 92, 246, 0.3)', marginTop: '10px' }}
          >
            🎲 남은 학생 랜덤 배치
          </button>
          
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
            <div ref={seat.nodeRef} className={`desk ${seat.bid !== 900 ? 'active' : ''}`} style={{ width: `${deskWidth}px`, height: `${deskHeight}px`, padding: `${15 * scale}px`, borderRadius: `${20 * scale}px` }}>
              <header style={{ fontSize: `${0.8 * scale}rem`, marginBottom: `${8 * scale}px` }}>
                좌석 #{seat.id + 1}
              </header>
              <div className="details" style={{justifyContent: 'center'}}>
                <div className="name-tag" style={{ fontSize: `${1.8 * scale}rem`, color: auctionStatus === 'ended' ? '#e11d48' : '#1e293b' }}>
                  {seat.bid === 900 ? "빈 자리" : (auctionStatus === 'ended' ? seat.realName : seat.nickname)}
                </div>
                <div className="score-box" style={{ fontSize: `${1.1 * scale}rem`, width: '100%', marginTop: `${15 * scale}px` }}>
                  {seat.bid === 900 ? "900 P" : (seat.bid === 0 ? "랜덤 배치" : seat.bid + " P")}
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
// 2. 학생용 스마트폰 화면 (+ 취소 버튼 및 내 자리 확인 기능)
// ==========================================
function StudentView() {
  const [realName, setRealName] = useState("");
  const [nickname, setNickname] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  
  const [seats, setSeats] = useState([]);
  const [cols, setCols] = useState(4);
  const [auctionStatus, setAuctionStatus] = useState("waiting");
  
  const [biddingSeat, setBiddingSeat] = useState(null);
  const [tempBid, setTempBid] = useState(0);
  const [myPoints, setMyPoints] = useState(0);

  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

  const GAS_URL = "https://script.google.com/macros/s/AKfycbxwC4npay5vdEkSGWXHf744a0h9JPR4HYaX6EgJRDZjVhgmsPMFA-ysOuo1dxv_GKgwog/exec?type=status";

  const fetchMyPoints = async (name) => {
    try {
      const response = await fetch(GAS_URL);
      const data = await response.json();
      
      const dataArray = Array.isArray(data) ? data : (data.data || []);
      const targetName = name.replace(/\s+/g, '');
      
      const studentData = dataArray.find(row => {
        const sheetName = String(row["이름"] || "").replace(/\s+/g, '');
        return sheetName === targetName;
      });
      
      if (studentData) {
        const pointString = String(studentData["잔액"] || "0");
        const cleanPoint = Number(pointString.replace(/[^0-9-]/g, ''));
        setMyPoints(cleanPoint);
        return true; 
      } else {
        setMyPoints(0);
        return false; 
      }
    } catch (error) {
      console.error("데이터 통신 에러:", error);
      return false; 
    }
  };

  useEffect(() => {
    const handleResize = () => setDimensions({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);

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
    return () => window.removeEventListener('resize', handleResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleJoin = async () => {
    const trimmedName = realName.trim();
    if (!trimmedName) return alert("이름을 입력해주세요!");

    setIsJoining(true);
    const isNameValid = await fetchMyPoints(trimmedName);
    setIsJoining(false);

    if (!isNameValid) {
      return alert("🚫 명단에 없는 이름입니다!\n오타나 띄어쓰기가 없는지 다시 확인해 주세요.");
    }

    const newNick = generateNickname();
    setNickname(newNick);
    setIsJoined(true);
    localStorage.setItem('student_realName', trimmedName);
    localStorage.setItem('student_nickname', newNick);
    
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
    if (seat.bid === 0) return alert("선생님께서 랜덤으로 배치 완료한 자리는 빼앗을 수 없습니다!");
    
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

  // 💡 [새로 추가됨] 입찰 취소 기능
  const handleCancelBid = () => {
    if (window.confirm("정말 이 자리의 입찰을 취소하시겠습니까?\n취소하면 즉시 빈 자리(900P)가 됩니다.")) {
      const updates = {};
      updates[`seats/${biddingSeat.id}/bid`] = 900;
      updates[`seats/${biddingSeat.id}/nickname`] = '';
      updates[`seats/${biddingSeat.id}/realName`] = '';
      update(ref(db), updates);
      setBiddingSeat(null); // 모달 닫기
    }
  };

  if (!isJoined) {
    return (
      <div className="student-login">
        <h2>블라인드 자리 경매</h2>
        <input 
          type="text" 
          placeholder="본인 실명 입력 (예: 김철수)" 
          value={realName} 
          onChange={e => setRealName(e.target.value)} 
          disabled={isJoining}
        />
        <button 
          onClick={handleJoin} 
          disabled={isJoining}
          style={{ background: isJoining ? '#94a3b8' : '#4f46e5' }}
        >
          {isJoining ? "명단 확인 중...⏳" : "입장하기 (암호명 발급)"}
        </button>
      </div>
    );
  }

  const teacherCols = cols || 4;
  const teacherScale = Math.min(1.2, 4 / teacherCols);

  const gridSeats = seats.map(seat => {
    const x = seat.x !== undefined ? seat.x : 0;
    const y = seat.y !== undefined ? seat.y : 0;
    
    const colIndex = Math.max(1, Math.round((x - 150) / (300 * teacherScale)) + 1);
    const rowIndex = Math.max(1, Math.round((y - 180) / (230 * teacherScale)) + 1);
    
    return { ...seat, c: colIndex, r: rowIndex };
  });

  const maxCol = Math.max(...gridSeats.map(s => s.c), teacherCols, 1);
  const fontScale = Math.min(1, 4 / maxCol);

  return (
    <div className="student-app" style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
      <div className="student-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 15px', flexShrink: 0, background: '#1e293b', color: 'white' }}>
        <div style={{ lineHeight: '1.4' }}>
          <div>내 암호명: <strong>{nickname}</strong> <span style={{fontSize: '0.8rem', fontWeight: 'normal', color: '#cbd5e1'}}>({realName})</span></div>
          <div style={{ fontSize: '0.85rem', color: '#fbbf24' }}>💰 잔여 포인트: {myPoints.toLocaleString()}P</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
          <div className="status-badge" style={{ background: auctionStatus === 'active' ? '#ef4444' : '#f59e0b', padding: '4px 8px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 'bold' }}>
            {auctionStatus === 'waiting' ? '대기중' : auctionStatus === 'active' ? '🔥 진행중' : '🛑 종료됨'}
          </div>
          <button onClick={handleLogout} style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #94a3b8', borderRadius: '6px', fontSize: '0.75rem', padding: '4px 8px', cursor: 'pointer' }}>
            로그아웃
          </button>
        </div>
      </div>
      
      <div style={{ flexGrow: 1, overflowY: 'auto', padding: '15px' }}>
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: `repeat(${maxCol}, minmax(0, 1fr))`, 
          gridAutoRows: '1fr', 
          gap: '8px' 
        }}>
          
          <div style={{ gridColumn: `1 / span ${maxCol}`, gridRow: 1, background: '#cbd5e1', color: '#334155', padding: '10px', textAlign: 'center', borderRadius: '12px', fontWeight: '900', fontSize: '1.1rem', marginBottom: '5px', border: '2px solid #94a3b8' }}>
            👨‍🏫 교 탁
          </div>

          {gridSeats.map((seat) => (
            <div key={seat.id} className={`student-desk ${seat.nickname === nickname ? 'my-seat' : ''}`} onClick={() => openBidModal(seat)}
                 style={{ 
                   gridColumn: seat.c,
                   gridRow: seat.r + 1, 
                   background: seat.nickname === nickname ? '#eef2ff' : 'white',
                   border: `2px solid ${seat.nickname === nickname ? '#4f46e5' : '#cbd5e1'}`,
                   borderRadius: '10px', padding: '10px 5px', textAlign: 'center', cursor: 'pointer',
                   boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                   display: 'flex', flexDirection: 'column', justifyContent: 'center'
                 }}>
              <div style={{ fontSize: `${0.7 * fontScale}rem`, color: '#94a3b8', fontWeight: 'bold', marginBottom: '6px' }}>
                #{seat.id + 1}
              </div>
              
              {/* 💡 [핵심 마법 1] 내 자리인 경우 닉네임 밑에 (진짜이름)을 띄워줍니다! */}
              <div style={{ fontSize: `${1.1 * fontScale}rem`, fontWeight: '900', color: '#1e293b', marginBottom: '6px', wordBreak: 'keep-all', lineHeight: '1.2' }}>
                 {seat.bid === 900 
                   ? "입찰가능" 
                   : (auctionStatus === 'ended' 
                       ? seat.realName 
                       : (seat.nickname === nickname 
                           ? <>{seat.nickname}<br/><span style={{fontSize: '0.8em', color: '#4f46e5'}}>({realName})</span></> 
                           : seat.nickname)
                     )
                 }
              </div>
              
              <div style={{ fontSize: `${1.0 * fontScale}rem`, fontWeight: '800', color: '#ef4444' }}>
                {seat.bid === 900 ? "900P" : (seat.bid === 0 ? "랜덤" : seat.bid + "P")}
              </div>
            </div>
          ))}
        </div>
      </div>

      {biddingSeat && (
        <div className="auction-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
          <div className="auction-modal" style={{ background: 'white', width: '90%', maxWidth: '400px', padding: '1.5rem', borderRadius: '20px', textAlign: 'center' }}>
            <h2 className="auction-title">🪑 좌석 #{biddingSeat.id + 1} 입찰</h2>
            <p style={{fontSize: '0.85rem', color: '#64748b', marginTop: '5px'}}>다른 자리를 선택하면 기존 입찰은 취소됩니다.</p>
            
            <div className="bid-section" style={{ padding: '1rem', marginTop: '10px', background: '#f8fafc', borderRadius: '12px' }}>
              <span className="bid-label" style={{ display: 'block', marginBottom: '10px', color: '#64748b' }}>내가 베팅할 금액 (보유: {myPoints}P)</span>
              
              <div className="bid-amount" style={{ fontSize: '2.5rem', color: tempBid > myPoints ? '#ef4444' : '#4f46e5', fontWeight: '900' }}>
                {tempBid} P
              </div>
              
              <div className="bid-controls" style={{ marginTop: '15px', display: 'flex', gap: '8px', justifyContent: 'center' }}>
                <button onClick={() => setTempBid(p => p + 100)} style={{ flex: 1, padding: '12px 0', fontSize: '1.1rem', fontWeight: 'bold', borderRadius: '8px', border: '1px solid #cbd5e1', background: 'white' }}>+ 100</button>
                <button onClick={() => setTempBid(p => p + 500)} style={{ flex: 1, padding: '12px 0', fontSize: '1.1rem', fontWeight: 'bold', borderRadius: '8px', border: '1px solid #cbd5e1', background: 'white' }}>+ 500</button>
                <button onClick={() => setTempBid(p => p + 1000)} style={{ flex: 1, padding: '12px 0', fontSize: '1.1rem', fontWeight: 'bold', borderRadius: '8px', border: '1px solid #cbd5e1', background: 'white' }}>+ 1000</button>
              </div>
              
              <button onClick={() => setTempBid(biddingSeat.bid === 900 ? 1000 : biddingSeat.bid + 100)} style={{ marginTop: '15px', border: 'none', background: 'transparent', color: '#64748b', textDecoration: 'underline', cursor: 'pointer' }}>
                금액 다시 입력하기
              </button>
            </div>

            <button onClick={confirmBid} style={{ width: '100%', padding: '16px', background: tempBid > myPoints ? '#94a3b8' : '#4f46e5', color: 'white', border: 'none', borderRadius: '12px', fontSize: '1.2rem', fontWeight: '800', marginTop: '15px', cursor: tempBid > myPoints ? 'not-allowed' : 'pointer' }}>
              {tempBid > myPoints ? "포인트 부족 🚫" : `✅ ${tempBid}P로 입찰 확정!`}
            </button>

            {/* 💡 [핵심 마법 2] 현재 터치한 자리가 내 자리일 경우 입찰 취소 버튼이 나타납니다. */}
            {biddingSeat.nickname === nickname && (
              <button onClick={handleCancelBid} style={{ width: '100%', padding: '16px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '12px', fontSize: '1.2rem', fontWeight: '800', marginTop: '10px', cursor: 'pointer' }}>
                ❌ 내 입찰 취소하기
              </button>
            )}
            
            <button className="btn-close-auction" style={{ background: '#cbd5e1', color: '#334155', padding: '12px', marginTop: '10px', width: '100%', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: '700', cursor: 'pointer' }} onClick={() => setBiddingSeat(null)}>
              닫기
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