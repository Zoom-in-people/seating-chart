import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Draggable from 'react-draggable';
import html2canvas from 'html2canvas';
import { db } from './firebase';
import { ref, onValue, set, update, get, onDisconnect, remove } from "firebase/database";
import './App.css';

// --- 무작위 별명 생성기 ---
const adjectives = ['붉은', '푸른', '춤추는', '용감한', '날쌘', '지혜로운', '신비한', '고독한', '즐거운', '빛나는'];
const nouns = ['매', '늑대', '호랑이', '사자', '독수리', '돌고래', '거북이', '고양이', '강아지', '여우'];
const generateNickname = () => `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;

const getDeviceId = () => {
  let id = localStorage.getItem('device_id');
  if (!id) {
    id = Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem('device_id', id);
  }
  return id;
};

const formatTime = (ms) => {
  if (ms <= 0) return "00:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const s = (totalSec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

// 한 좌석당 최대 입찰 가능 횟수
const MAX_BIDS_PER_SEAT = 5;
// 마감 임박(5초 이하) 시 입찰하면 연장되는 시간
const ANTI_SNIPE_MS = 5000;

// ==========================================
// 1. 선생님용 메인 화면
// ==========================================
function TeacherView() {
  const [studentInput, setStudentInput] = useState("");
  const [seatCount, setSeatCount] = useState(24);
  const [cols, setCols] = useState(4);
  const [seats, setSeats] = useState([]);
  const [auctionStatus, setAuctionStatus] = useState("waiting");

  const [editingSeat, setEditingSeat] = useState(null);
  const [editBid, setEditBid] = useState(900);
  const [editName, setEditName] = useState("");

  const [showTimerModal, setShowTimerModal] = useState(false);
  const [timerMin, setTimerMin] = useState(5);
  const [timerSec, setTimerSec] = useState(0);

  // 좌석별 타이머 표시/잠금 처리를 위한 now 틱
  const [nowTick, setNowTick] = useState(Date.now());
  const seatsRef = useRef(seats);
  const statusRef = useRef(auctionStatus);

  const canvasRef = useRef(null);
  const teacherRef = useRef(null);

  const scale = Math.min(1.2, 4 / (cols || 1)); 
  const deskWidth = 220 * scale;
  const deskHeight = 150 * scale;

  useEffect(() => { seatsRef.current = seats; }, [seats]);
  useEffect(() => { statusRef.current = auctionStatus; }, [auctionStatus]);

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
            const fbSeat = data.seats && data.seats[i] ? data.seats[i] : { bid: 900, baseBid: 900, nickname: '', realName: '' };
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

  // 1초마다 화면 갱신 + 마감된 좌석 잠금 처리
  useEffect(() => {
    const t = setInterval(() => {
      setNowTick(Date.now());
      if (statusRef.current === 'active') {
        seatsRef.current.forEach(seat => {
          if (seat.endTime && !seat.locked && seat.endTime - Date.now() <= 0) {
            set(ref(db, `seats/${seat.id}/locked`), true);
          }
        });
      }
    }, 1000);
    return () => clearInterval(t);
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

  const handleFullReset = () => {
    if (window.confirm("정말 모든 자리를 완전히 초기화하시겠습니까?\n\n(모든 학생 배치가 해제되고 900P 빈 자리로 돌아갑니다.)")) {
      const updates = {};
      for (let i = 0; i < seatCount; i++) {
        updates[`seats/${i}/bid`] = 900;
        updates[`seats/${i}/baseBid`] = 900;
        updates[`seats/${i}/nickname`] = '';
        updates[`seats/${i}/realName`] = '';
        updates[`seats/${i}/isFixed`] = null;
        updates[`seats/${i}/endTime`] = null;
        updates[`seats/${i}/locked`] = null;
      }
      updates['status'] = 'waiting';
      updates['bidCounts'] = null; 
      update(ref(db), updates);
    }
  };

  // 💡 [신규] 좌석 인원 초기화: 포인트는 유지, 배정된 이름만 빈 자리로
  const handleResetSeatNames = () => {
    if (window.confirm("모든 좌석의 '배정된 이름'만 초기화하시겠습니까?\n\n✅ 좌석별 포인트(P)는 그대로 유지됩니다.\n❌ 배정된 학생 이름/별명만 지워지고 '빈 자리(지정 안함)' 상태가 됩니다.")) {
      const updates = {};
      for (let i = 0; i < seatCount; i++) {
        updates[`seats/${i}/nickname`] = '';
        updates[`seats/${i}/realName`] = '';
        updates[`seats/${i}/isFixed`] = null;
      }
      update(ref(db), updates);
      alert("모든 좌석의 이름이 초기화되었습니다. (포인트는 유지됨)");
    }
  };

  const handleOpenTimerModal = () => {
    setShowTimerModal(true);
  };

  // 💡 [수정] 경매 시작: 글로벌 타이머 대신 "좌석별" 타이머를 동일 시각으로 세팅
  const confirmStartAuction = () => {
    const min = Number(timerMin) || 0;
    const sec = Number(timerSec) || 0;
    const totalMs = (min * 60 + sec) * 1000;

    if (totalMs <= 0) return alert("경매 시간을 1초 이상으로 설정해주세요!");

    if (window.confirm(`현재 지정된 자리와 금액을 유지하며 ${min}분 ${sec}초 동안 경매를 시작합니까?\n(각 좌석은 독립적으로 타이머가 흐르며, 마감 5초 전 입찰 시 해당 좌석만 5초 연장됩니다.)`)) {
      const updates = {};
      const seatEndTime = Date.now() + totalMs;

      seats.forEach(seat => {
        updates[`seats/${seat.id}/baseBid`] = seat.bid || 900;
        updates[`seats/${seat.id}/endTime`] = seatEndTime;
        updates[`seats/${seat.id}/locked`] = false;
      });
      
      updates['status'] = 'active';
      updates['bidCounts'] = null; 
      update(ref(db), updates);
      
      setShowTimerModal(false);
    }
  };

  const handleEndAuction = () => {
    if (window.confirm("경매를 종료하고 학생들의 진짜 이름을 공개하시겠습니까?")) {
      const updates = { status: 'ended' };
      seats.forEach(seat => {
        updates[`seats/${seat.id}/locked`] = true;
      });
      update(ref(db), updates);
    }
  };

  const handleRandomAssign = () => {
    if (window.confirm("경매에 참여하지 않은 학생들을 빈 자리에 랜덤으로 배치하시겠습니까?")) {
      const allNames = studentInput.split(/[,\n]+/).map(n => n.trim()).filter(n => n);
      const assignedNames = seats.map(s => s.realName).filter(n => n);
      const unassignedNames = allNames.filter(n => !assignedNames.includes(n));
      const emptySeats = seats.filter(s => s.bid === 900 || !s.realName);

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

  const handleUnlockUsers = () => {
    if (window.confirm("학생들의 '기기 귀속(접속 잠금)'을 해제하시겠습니까?\n\n- 다른 기기로 다시 로그인해야 하는 학생이 있을 때 누르세요.\n- 진행 중인 경매 입찰 기록은 지워지지 않습니다.")) {
      remove(ref(db, 'activeUsers'));
      alert("접속 잠금이 모두 해제되었습니다! 튕긴 학생들에게 다시 로그인하라고 안내해 주세요.");
    }
  };

  const openEditModal = (seat) => {
    setEditingSeat(seat);
    setEditBid(seat.bid === 900 && !seat.realName ? 900 : seat.bid);
    setEditName(seat.realName || "");
  };

  const saveSeatEdit = () => {
    const updates = {};
    updates[`seats/${editingSeat.id}/bid`] = editBid;
    updates[`seats/${editingSeat.id}/baseBid`] = editBid; 
    
    const trimmedName = editName.replace(/\s+/g, '');
    if (trimmedName) {
      updates[`seats/${editingSeat.id}/realName`] = trimmedName;
      updates[`seats/${editingSeat.id}/nickname`] = editingSeat.nickname || generateNickname();
      updates[`seats/${editingSeat.id}/isFixed`] = true; 
    } else {
      updates[`seats/${editingSeat.id}/realName`] = '';
      updates[`seats/${editingSeat.id}/nickname`] = '';
      updates[`seats/${editingSeat.id}/isFixed`] = null;
    }
    
    update(ref(db), updates);
    setEditingSeat(null);
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
            <>
              <button 
                onClick={handleOpenTimerModal} 
                style={{ width: '100%', padding: '16px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '12px', fontSize: '1.1rem', fontWeight: '800', cursor: 'pointer', boxShadow: '0 4px 12px rgba(239, 68, 68, 0.3)' }}
              >
                ▶️ 경매 시작 (+ 타이머)
              </button>

              <button 
                onClick={handleFullReset} 
                style={{ width: '100%', padding: '12px', background: '#f8fafc', color: '#ef4444', border: '2px solid #ef4444', borderRadius: '12px', fontSize: '1rem', fontWeight: '700', cursor: 'pointer', marginTop: '10px' }}
              >
                🔄 전체 900P 초기화
              </button>
            </>
          ) : (
            <button className="btn-auction-end" onClick={handleEndAuction}>🛑 경매 종료 및 정체 공개!</button>
          )}

          {/* 💡 [신규] 좌석 인원 초기화 버튼 */}
          <button 
            onClick={handleResetSeatNames}
            style={{ width: '100%', padding: '14px', background: '#fff7ed', color: '#c2410c', border: '2px solid #fb923c', borderRadius: '12px', fontSize: '1rem', fontWeight: '800', cursor: 'pointer', marginTop: '10px' }}
          >
            🧹 좌석 인원 초기화 (포인트는 유지)
          </button>
          
          <button 
            onClick={handleRandomAssign} 
            style={{ width: '100%', padding: '16px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: '12px', fontSize: '1.1rem', fontWeight: '800', cursor: 'pointer', boxShadow: '0 4px 12px rgba(139, 92, 246, 0.3)', marginTop: '10px' }}
          >
            🎲 남은 학생 랜덤 배치
          </button>
          
          <button 
            onClick={handleUnlockUsers} 
            style={{ width: '100%', padding: '12px', background: '#f8fafc', color: '#64748b', border: '2px solid #cbd5e1', borderRadius: '12px', fontSize: '1rem', fontWeight: '700', cursor: 'pointer', marginTop: '10px' }}
          >
            🔓 접속 잠금 초기화 (비상용)
          </button>
          
          <p className="hint" style={{marginTop:'10px'}}>* 접속 주소: 웹주소/student</p>
          <p className="hint" style={{marginTop:'4px', fontSize:'0.8rem', color:'#94a3b8'}}>* 좌석당 입찰 최대 {MAX_BIDS_PER_SEAT}회 / 마감 5초 전 입찰 시 해당 좌석 5초 연장</p>
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

        {seats.map((seat) => {
          const remain = seat.endTime ? Math.max(0, seat.endTime - nowTick) : null;
          const isLocked = !!seat.locked || (remain !== null && remain <= 0);
          return (
            <Draggable 
              key={seat.id} 
              nodeRef={seat.nodeRef} 
              position={{x: seat.x, y: seat.y}}
              onStop={(e, data) => handleStop(seat.id, e, data)}
              cancel=".cancel-drag"
            >
              <div ref={seat.nodeRef} className={`desk ${seat.realName ? 'active' : ''}`} style={{ width: `${deskWidth}px`, height: `${deskHeight}px`, padding: `${15 * scale}px`, borderRadius: `${20 * scale}px` }}>
                <header style={{ fontSize: `${0.8 * scale}rem`, marginBottom: `${8 * scale}px`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>좌석 #{seat.id + 1}</span>

                  {auctionStatus === 'active' && seat.endTime ? (
                    <span style={{ fontWeight: 800, color: isLocked ? '#16a34a' : (remain <= ANTI_SNIPE_MS ? '#ef4444' : '#64748b') }}>
                      {isLocked ? '🔒 마감' : formatTime(remain)}
                    </span>
                  ) : (
                    auctionStatus !== 'active' && (
                      <button 
                        className="cancel-drag"
                        onClick={(e) => { e.stopPropagation(); openEditModal(seat); }}
                        style={{ background: '#e2e8f0', border: 'none', borderRadius: '4px', fontSize: `${0.7 * scale}rem`, padding: '3px 6px', cursor: 'pointer', color: '#475569', fontWeight: 'bold' }}
                      >
                        ⚙️ 설정
                      </button>
                    )
                  )}
                </header>
                <div className="details" style={{justifyContent: 'center'}}>
                  <div className="name-tag" style={{ fontSize: `${1.8 * scale}rem`, color: auctionStatus === 'ended' ? '#e11d48' : '#1e293b' }}>
                    {!seat.realName ? "빈 자리" : (seat.isFixed || auctionStatus === 'ended' ? seat.realName : seat.nickname)}
                  </div>
                  <div className="score-box" style={{ fontSize: `${1.1 * scale}rem`, width: '100%', marginTop: `${15 * scale}px` }}>
                    {seat.bid === 0 ? "랜덤 배치" : `${seat.bid} P`}
                  </div>
                </div>
              </div>
            </Draggable>
          );
        })}
      </main>

      {showTimerModal && (
        <div className="auction-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div className="auction-modal" style={{ background: 'white', width: '90%', maxWidth: '350px', padding: '2rem', borderRadius: '16px', textAlign: 'center', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
            <h2 style={{ marginTop: 0, color: '#1e293b' }}>⏱️ 경매 타이머 설정</h2>
            <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '20px' }}>경매 진행 시간을 설정해 주세요. (각 좌석에 동일하게 적용되며, 이후 좌석별로 독립적으로 흐릅니다)</p>
            
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <input 
                  type="number" 
                  min="0"
                  value={timerMin} 
                  onChange={(e) => setTimerMin(e.target.value)}
                  style={{ width: '80px', padding: '12px', borderRadius: '8px', border: '2px solid #cbd5e1', textAlign: 'center', fontSize: '1.5rem', fontWeight: 'bold', color: '#ef4444' }}
                />
                <span style={{ marginTop: '5px', fontWeight: 'bold', color: '#475569' }}>분</span>
              </div>
              <span style={{ fontSize: '2rem', fontWeight: 'bold', color: '#94a3b8', paddingBottom: '20px' }}>:</span>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <input 
                  type="number" 
                  min="0" max="59"
                  value={timerSec} 
                  onChange={(e) => setTimerSec(e.target.value)}
                  style={{ width: '80px', padding: '12px', borderRadius: '8px', border: '2px solid #cbd5e1', textAlign: 'center', fontSize: '1.5rem', fontWeight: 'bold', color: '#ef4444' }}
                />
                <span style={{ marginTop: '5px', fontWeight: 'bold', color: '#475569' }}>초</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '25px' }}>
              <button onClick={() => setShowTimerModal(false)} style={{ flex: 1, padding: '14px', borderRadius: '8px', border: 'none', background: '#e2e8f0', color: '#475569', cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem' }}>취소</button>
              <button onClick={confirmStartAuction} style={{ flex: 2, padding: '14px', borderRadius: '8px', border: 'none', background: '#ef4444', color: 'white', cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem' }}>▶️ 경매 확정 시작</button>
            </div>
          </div>
        </div>
      )}

      {editingSeat && (
        <div className="auction-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div className="auction-modal" style={{ background: 'white', width: '90%', maxWidth: '350px', padding: '2rem', borderRadius: '16px', textAlign: 'center', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
            <h2 style={{ marginTop: 0, color: '#1e293b' }}>🪑 좌석 #{editingSeat.id + 1} 설정</h2>
            
            <div style={{ margin: '20px 0', textAlign: 'left' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#475569' }}>지정할 학생 선택</label>
              <select 
                value={editName} 
                onChange={(e) => setEditName(e.target.value)}
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '1rem' }}
              >
                <option value="">-- 빈 자리 (지정 안함) --</option>
                {studentInput.split(/[,\n]+/).map(n => n.trim()).filter(n => n).map((name, idx) => (
                  <option key={idx} value={name}>{name}</option>
                ))}
              </select>
            </div>

            <div style={{ margin: '20px 0', textAlign: 'left' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#475569' }}>시작 포인트</label>
              <input 
                type="number" 
                value={editBid} 
                onChange={(e) => setEditBid(Number(e.target.value))}
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '1.2rem', fontWeight: 'bold', color: '#ef4444' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '25px' }}>
              <button onClick={() => setEditingSeat(null)} style={{ flex: 1, padding: '14px', borderRadius: '8px', border: 'none', background: '#e2e8f0', color: '#475569', cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem' }}>취소</button>
              <button onClick={saveSeatEdit} style={{ flex: 1, padding: '14px', borderRadius: '8px', border: 'none', background: '#4f46e5', color: 'white', cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem' }}>저장</button>
            </div>
          </div>
        </div>
      )}
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
  const [isJoining, setIsJoining] = useState(false);
  
  const [showWelcome, setShowWelcome] = useState(false);
  
  const [seats, setSeats] = useState([]);
  const [cols, setCols] = useState(4);
  const [auctionStatus, setAuctionStatus] = useState("waiting");

  const [biddingSeat, setBiddingSeat] = useState(null);
  const [tempBid, setTempBid] = useState(0);
  const [myPoints, setMyPoints] = useState(0);

  // 좌석별 입찰 횟수: { [seatId]: count }
  const [seatBidCounts, setSeatBidCounts] = useState({});

  // 좌석 타이머 표시/잠금 처리를 위한 now 틱
  const [nowTick, setNowTick] = useState(Date.now());
  const seatsRef = useRef(seats);
  const statusRef = useRef(auctionStatus);

  const deviceId = useRef(getDeviceId());
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

  useEffect(() => { seatsRef.current = seats; }, [seats]);
  useEffect(() => { statusRef.current = auctionStatus; }, [auctionStatus]);

  // 좌석별 입찰 횟수 구독
  useEffect(() => {
    if (realName && isJoined) {
      const bidRef = ref(db, `bidCounts/${realName}`);
      const unsubscribe = onValue(bidRef, (snap) => {
        setSeatBidCounts(snap.val() || {});
      });
      return () => unsubscribe();
    }
  }, [realName, isJoined]);

  useEffect(() => {
    const savedName = localStorage.getItem('student_realName');
    const savedNick = localStorage.getItem('student_nickname');
    
    if (savedName && savedNick) {
      setRealName(savedName);
      setNickname(savedNick);
      setIsJoined(true);
      fetchMyPoints(savedName);

      const userRef = ref(db, `activeUsers/${savedName}`);
      set(userRef, deviceId.current);
      onDisconnect(userRef).remove();
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

  // 1초마다 화면 갱신 + 마감된 좌석 잠금 처리
  useEffect(() => {
    const t = setInterval(() => {
      setNowTick(Date.now());
      if (statusRef.current === 'active') {
        seatsRef.current.forEach(seat => {
          if (seat.endTime && !seat.locked && seat.endTime - Date.now() <= 0) {
            set(ref(db, `seats/${seat.id}/locked`), true);
          }
        });
      }
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const handleJoin = async () => {
    const normalizedName = realName.replace(/\s+/g, '');
    if (!normalizedName) return alert("이름을 입력해주세요!");

    setRealName(normalizedName); 
    setIsJoining(true);

    const userRef = ref(db, `activeUsers/${normalizedName}`);
    const snapshot = await get(userRef);
    
    if (snapshot.exists()) {
      const existingDeviceId = snapshot.val();
      if (existingDeviceId !== deviceId.current) {
        setIsJoining(false);
        return alert(`🚫 '${normalizedName}' 학생은 이미 다른 기기에서 접속 중입니다!\n\n(만약 기기가 바뀌었다면 선생님께 '접속 잠금 초기화'를 요청하세요.)`);
      }
    }

    const isNameValid = await fetchMyPoints(normalizedName);
    
    if (!isNameValid) {
      setIsJoining(false);
      return alert("🚫 구글 시트 명단(B열)에 없는 이름입니다!\n오타나 띄어쓰기가 없는지 다시 확인해 주세요.");
    }

    await set(userRef, deviceId.current);
    onDisconnect(userRef).remove();

    const newNick = generateNickname();
    setNickname(newNick);
    setIsJoined(true);
    
    localStorage.setItem('student_realName', normalizedName);
    localStorage.setItem('student_nickname', newNick);
    
    setIsJoining(false);
    setShowWelcome(true); 
  };

  const handleLogout = async () => {
    if (window.confirm("로그아웃 하시겠습니까? (현재 입찰 기록은 유지됩니다)")) {
      const savedName = localStorage.getItem('student_realName');
      if (savedName) {
        await remove(ref(db, `activeUsers/${savedName}`));
      }

      localStorage.removeItem('student_realName');
      localStorage.removeItem('student_nickname');
      setRealName("");
      setNickname("");
      setMyPoints(0);
      setIsJoined(false);
    }
  };

  // 현재 좌석의 남은 시간(ms) 계산. 타이머가 없으면 null(제한 없음)
  const getRemain = (seat) => seat.endTime ? Math.max(0, seat.endTime - Date.now()) : null;
  const isSeatLocked = (seat) => {
    const remain = getRemain(seat);
    return !!seat.locked || (remain !== null && remain <= 0);
  };

  const openBidModal = (seat) => {
    if (auctionStatus !== 'active') return alert("현재 경매 진행 중이 아닙니다.");
    if (isSeatLocked(seat)) return alert("⏰ 이 자리는 경매 시간이 마감되어 더 이상 입찰할 수 없습니다.");
    if (seat.bid === 0) return alert("선생님께서 랜덤으로 배치 완료한 자리는 빼앗을 수 없습니다!");

    const usedCount = seatBidCounts[seat.id] || 0;
    if (usedCount >= MAX_BIDS_PER_SEAT) {
      return alert(`🚫 이 좌석에 입찰 가능한 횟수(${MAX_BIDS_PER_SEAT}회)를 모두 사용하였습니다!\n다른 좌석에는 입찰하실 수 있습니다.`);
    }
    
    setBiddingSeat(seat);
    setTempBid(!seat.realName && seat.bid === (seat.baseBid || 900) ? (seat.baseBid || 900) + 100 : seat.bid + 100);
  };

  const confirmBid = () => {
    // 최신 좌석 정보로 재검증 (모달 떠 있는 동안 상황이 바뀌었을 수 있음)
    const liveSeat = seats.find(s => s.id === biddingSeat.id) || biddingSeat;

    if (isSeatLocked(liveSeat)) {
      setBiddingSeat(null);
      return alert("⏰ 이 자리는 경매 시간이 마감되어 더 이상 입찰할 수 없습니다.");
    }

    const usedCount = seatBidCounts[liveSeat.id] || 0;
    if (usedCount >= MAX_BIDS_PER_SEAT) {
      setBiddingSeat(null);
      return alert(`🚫 이 좌석에 입찰 가능한 횟수(${MAX_BIDS_PER_SEAT}회)를 모두 사용하였습니다!`);
    }

    const base = liveSeat.baseBid || 900;
    if (tempBid <= liveSeat.bid && (liveSeat.bid !== base || liveSeat.realName)) {
      return alert("현재 자리의 입찰 포인트보다 무조건 더 높은 금액을 제시해야 합니다!");
    }
    if (tempBid > myPoints) {
      return alert(`보유 포인트가 부족합니다! (현재 잔여: ${myPoints}P)`);
    }

    const updates = {};
    seats.forEach(seat => {
      if (seat.realName === realName && seat.id !== liveSeat.id) {
        const oldBase = seat.baseBid || 900;
        updates[`seats/${seat.id}/bid`] = oldBase;
        updates[`seats/${seat.id}/nickname`] = '';
        updates[`seats/${seat.id}/realName`] = '';
        updates[`seats/${seat.id}/isFixed`] = null; 
      }
    });

    updates[`seats/${liveSeat.id}/bid`] = tempBid;
    updates[`seats/${liveSeat.id}/nickname`] = nickname;
    updates[`seats/${liveSeat.id}/realName`] = realName;
    updates[`seats/${liveSeat.id}/isFixed`] = null; 

    // 💡 [신규] 마감 5초 이하 남았을 때 입찰 -> 해당 좌석만 5초로 재연장 (Anti-snipe)
    const remain = getRemain(liveSeat);
    if (remain !== null && remain <= ANTI_SNIPE_MS) {
      updates[`seats/${liveSeat.id}/endTime`] = Date.now() + ANTI_SNIPE_MS;
    }

    // 💡 [신규] 좌석별 입찰 횟수 +1
    updates[`bidCounts/${realName}/${liveSeat.id}`] = usedCount + 1;

    update(ref(db), updates);
    setBiddingSeat(null); 
  };

  const handleCancelBid = () => {
    if (window.confirm("정말 이 자리의 입찰을 취소하시겠습니까?\n\n⚠️ 주의: 취소해도 차감된 '입찰 잔여 횟수'는 복구되지 않습니다!")) {
      const updates = {};
      const base = biddingSeat.baseBid || 900;
      updates[`seats/${biddingSeat.id}/bid`] = base;
      updates[`seats/${biddingSeat.id}/nickname`] = '';
      updates[`seats/${biddingSeat.id}/realName`] = '';
      updates[`seats/${biddingSeat.id}/isFixed`] = null;
      update(ref(db), updates);
      setBiddingSeat(null); 
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

  const liveBiddingSeat = biddingSeat ? (seats.find(s => s.id === biddingSeat.id) || biddingSeat) : null;
  const liveBiddingUsedCount = liveBiddingSeat ? (seatBidCounts[liveBiddingSeat.id] || 0) : 0;

  return (
    <div className="student-app" style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
      <div className="student-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 15px', flexShrink: 0, background: '#1e293b', color: 'white' }}>
        <div style={{ lineHeight: '1.4' }}>
          <div>내 암호명: <strong>{nickname}</strong> <span style={{fontSize: '0.8rem', fontWeight: 'normal', color: '#cbd5e1'}}>({realName})</span></div>
          <div style={{ fontSize: '0.85rem', color: '#fbbf24' }}>💰 잔여 포인트: {myPoints.toLocaleString()}P</div>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ background: '#3b82f6', color: 'white', padding: '4px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold' }}>
              좌석당 최대 {MAX_BIDS_PER_SEAT}회 입찰
            </div>
            <div className="status-badge" style={{ background: auctionStatus === 'active' ? '#ef4444' : (auctionStatus === 'ended' ? '#10b981' : '#f59e0b'), padding: '4px 8px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 'bold' }}>
              {auctionStatus === 'waiting' ? '대기중' : auctionStatus === 'active' ? '🔥 진행중' : '🛑 종료됨'}
            </div>
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

          {gridSeats.map((seat) => {
            const remain = getRemain(seat);
            const locked = isSeatLocked(seat);
            const isMine = seat.realName === realName;

            return (
              <div key={seat.id} className={`student-desk ${isMine ? 'my-seat' : ''}`} onClick={() => openBidModal(seat)}
                   style={{ 
                     gridColumn: seat.c,
                     gridRow: seat.r + 1, 
                     background: locked ? '#f1f5f9' : (isMine ? '#eef2ff' : 'white'),
                     border: `2px solid ${locked ? '#94a3b8' : (isMine ? '#4f46e5' : '#cbd5e1')}`,
                     borderRadius: '10px', padding: '10px 5px', textAlign: 'center', cursor: locked ? 'not-allowed' : 'pointer',
                     boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                     opacity: locked ? 0.7 : 1,
                     display: 'flex', flexDirection: 'column', justifyContent: 'center'
                   }}>
                <div style={{ fontSize: `${0.7 * fontScale}rem`, color: '#94a3b8', fontWeight: 'bold', marginBottom: '6px' }}>
                  #{seat.id + 1}
                </div>
                
                <div style={{ fontSize: `${1.1 * fontScale}rem`, fontWeight: '900', color: '#1e293b', marginBottom: '6px', wordBreak: 'keep-all', lineHeight: '1.2' }}>
                   {!seat.realName 
                     ? "입찰가능" 
                     : (auctionStatus === 'ended' || seat.isFixed 
                         ? seat.realName 
                         : (isMine 
                             ? <>{seat.nickname}<br/><span style={{fontSize: '0.8em', color: '#4f46e5'}}>({realName})</span></> 
                             : seat.nickname)
                       )
                   }
                </div>
                
                <div style={{ fontSize: `${1.0 * fontScale}rem`, fontWeight: '800', color: '#ef4444' }}>
                  {!seat.realName ? `${seat.bid}P` : (seat.bid === 0 ? "랜덤" : seat.bid + "P")}
                </div>

                {auctionStatus === 'active' && seat.endTime && (
                  <div style={{ fontSize: `${0.75 * fontScale}rem`, fontWeight: '800', marginTop: '4px', color: locked ? '#16a34a' : (remain <= ANTI_SNIPE_MS * 1000 ? '#ef4444' : '#64748b') }}>
                    {locked ? '🔒 마감' : `⏱️ ${formatTime(remain)}`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {showWelcome && (
        <div className="auction-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999 }}>
          <div className="auction-modal" style={{ background: 'white', width: '90%', maxWidth: '400px', padding: '2rem', borderRadius: '16px', textAlign: 'center', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
            <h2 style={{ marginTop: 0, color: '#1e293b', fontSize: '1.5rem' }}>📢 경매장 입장 안내</h2>
            
            <ol style={{ textAlign: 'left', lineHeight: '1.6', color: '#334155', paddingLeft: '20px', marginBottom: '25px', fontSize: '0.95rem' }}>
              <li style={{ marginBottom: '10px' }}>좌측 상단의 별명 옆에 <strong>자신의 이름이 정확히 뜨는지</strong> 확인하세요.</li>
              <li style={{ marginBottom: '10px' }}>경매 입찰 가능 횟수는 <strong style={{ color: '#ef4444', fontSize: '1.2em' }}>좌석 1개당 '{MAX_BIDS_PER_SEAT}회'</strong>입니다. (취소해도 횟수 차감)</li>
              <li style={{ marginBottom: '10px' }}>각 좌석은 <strong>독립적인 타이머</strong>가 흐르며, <strong>마감 5초 전</strong>에 입찰하면 그 좌석만 5초가 다시 늘어납니다.</li>
              <li style={{ marginBottom: '10px' }}>좌석 타이머가 <strong>0초가 되면 그 좌석은 잠겨</strong> 더 이상 입찰할 수 없습니다.</li>
              <li style={{ marginBottom: '10px' }}>이번에 입찰한 자리의 금액이 <strong>다음 입찰의 최소 금액</strong>이 됩니다.</li>
              <li>주인이 정해지지 않은 자리는 선생님이 설정한 <strong>최소 금액(기본 900P)</strong>부터 시작됩니다.</li>
            </ol>
            
            <button 
              onClick={() => setShowWelcome(false)} 
              style={{ width: '100%', padding: '14px', borderRadius: '12px', border: 'none', background: '#4f46e5', color: 'white', cursor: 'pointer', fontWeight: '900', fontSize: '1.1rem' }}
            >
              네, 확인했습니다!
            </button>
          </div>
        </div>
      )}

      {biddingSeat && liveBiddingSeat && (
        <div className="auction-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
          <div className="auction-modal" style={{ background: 'white', width: '90%', maxWidth: '400px', padding: '1.5rem', borderRadius: '20px', textAlign: 'center' }}>
            <h2 className="auction-title">🪑 좌석 #{liveBiddingSeat.id + 1} 입찰</h2>
            <p style={{fontSize: '0.85rem', color: '#64748b', marginTop: '5px'}}>다른 자리를 선택하면 기존 입찰은 취소됩니다.</p>
            
            <div className="bid-section" style={{ padding: '1rem', marginTop: '10px', background: '#f8fafc', borderRadius: '12px' }}>
              <span className="bid-label" style={{ display: 'block', marginBottom: '10px', color: '#ef4444', fontWeight: 'bold' }}>
                ⚠️ 신중하게 입찰하세요! (이 좌석 남은 입찰: {Math.max(0, MAX_BIDS_PER_SEAT - liveBiddingUsedCount)}회)
              </span>
              <span className="bid-label" style={{ display: 'block', marginBottom: '10px', color: '#64748b' }}>내가 베팅할 금액 (보유: {myPoints}P)</span>
              
              <div className="bid-amount" style={{ fontSize: '2.5rem', color: tempBid > myPoints ? '#ef4444' : '#4f46e5', fontWeight: '900' }}>
                {tempBid} P
              </div>
              
              <div className="bid-controls" style={{ marginTop: '15px', display: 'flex', gap: '8px', justifyContent: 'center' }}>
                <button onClick={() => setTempBid(p => p + 100)} style={{ flex: 1, padding: '12px 0', fontSize: '1.1rem', fontWeight: 'bold', borderRadius: '8px', border: '1px solid #cbd5e1', background: 'white' }}>+ 100</button>
                <button onClick={() => setTempBid(p => p + 500)} style={{ flex: 1, padding: '12px 0', fontSize: '1.1rem', fontWeight: 'bold', borderRadius: '8px', border: '1px solid #cbd5e1', background: 'white' }}>+ 500</button>
                <button onClick={() => setTempBid(p => p + 1000)} style={{ flex: 1, padding: '12px 0', fontSize: '1.1rem', fontWeight: 'bold', borderRadius: '8px', border: '1px solid #cbd5e1', background: 'white' }}>+ 1000</button>
              </div>
              
              <button onClick={() => setTempBid(!liveBiddingSeat.realName && liveBiddingSeat.bid === (liveBiddingSeat.baseBid || 900) ? (liveBiddingSeat.baseBid || 900) + 100 : liveBiddingSeat.bid + 100)} style={{ marginTop: '15px', border: 'none', background: 'transparent', color: '#64748b', textDecoration: 'underline', cursor: 'pointer' }}>
                금액 다시 입력하기
              </button>

              {(() => {
                const remain = getRemain(liveBiddingSeat);
                if (remain === null) return null;
                return (
                  <div style={{ marginTop: '12px', fontSize: '0.85rem', fontWeight: 800, color: remain <= ANTI_SNIPE_MS ? '#ef4444' : '#64748b' }}>
                    ⏱️ 이 좌석 남은 시간: {formatTime(remain)}
                    {remain <= ANTI_SNIPE_MS && " (지금 입찰하면 5초 연장!)"}
                  </div>
                );
              })()}
            </div>

            <button onClick={confirmBid} style={{ width: '100%', padding: '16px', background: tempBid > myPoints ? '#94a3b8' : '#4f46e5', color: 'white', border: 'none', borderRadius: '12px', fontSize: '1.2rem', fontWeight: '800', marginTop: '15px', cursor: tempBid > myPoints ? 'not-allowed' : 'pointer' }}>
              {tempBid > myPoints ? "포인트 부족 🚫" : `✅ ${tempBid}P로 입찰 확정!`}
            </button>

            {liveBiddingSeat.realName === realName && (
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