import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import './dtrader.scss';

type ActiveSymbol = {
    symbol: string;
    display_name: string;
    market: string;
    market_display_name: string;
    submarket: string;
    submarket_display_name: string;
    exchange_is_open: number;
    pip: string;
};

type TradeRecord = {
    id: string;
    contract_type: 'CALL' | 'PUT';
    symbol: string;
    stake: number;
    payout: number;
    entry_spot: number;
    status: 'open' | 'won' | 'lost';
    profit?: number;
    time: string;
};

type TradeType = {
    id: string;
    label: string;
    icon: string;
    contract_call: string;
    contract_put: string;
    call_label: string;
    put_label: string;
    call_color: 'rise' | 'higher' | 'touch' | 'over';
    put_color: 'fall' | 'lower' | 'notouch' | 'under';
};

const TRADE_TYPES: TradeType[] = [
    { id: 'rise_fall', label: 'Rise/Fall', icon: '↕', contract_call: 'CALL', contract_put: 'PUT', call_label: 'Rise', put_label: 'Fall', call_color: 'rise', put_color: 'fall' },
    { id: 'higher_lower', label: 'Higher/Lower', icon: '⇅', contract_call: 'CALL', contract_put: 'PUT', call_label: 'Higher', put_label: 'Lower', call_color: 'higher', put_color: 'lower' },
    { id: 'touch_no_touch', label: 'Touch/No Touch', icon: '⊙', contract_call: 'ONETOUCH', contract_put: 'NOTOUCH', call_label: 'Touch', put_label: 'No Touch', call_color: 'touch', put_color: 'notouch' },
    { id: 'over_under', label: 'Over/Under', icon: '≷', contract_call: 'DIGITOVER', contract_put: 'DIGITUNDER', call_label: 'Over', put_label: 'Under', call_color: 'over', put_color: 'under' },
];

const DURATION_UNITS = [
    { label: 'Ticks', short: 't', value: 't', min: 1, max: 10 },
    { label: 'Min', short: 'm', value: 'm', min: 1, max: 60 },
    { label: 'Hours', short: 'h', value: 'h', min: 1, max: 24 },
];

const MAX_CHART_POINTS = 80;
const TICK_HEIGHT = 160;

const DTrader = () => {
    const [symbols, setSymbols] = useState<ActiveSymbol[]>([]);
    const [selectedSymbol, setSelectedSymbol] = useState<string>('R_100');
    const [selectedSymbolName, setSelectedSymbolName] = useState<string>('Volatility 100 Index');
    const [isMarketOpen, setIsMarketOpen] = useState<boolean>(true);
    const [currentPrice, setCurrentPrice] = useState<string | null>(null);
    const [prevPrice, setPrevPrice] = useState<string | null>(null);
    const [priceDirection, setPriceDirection] = useState<'up' | 'down' | null>(null);
    const [tickHistory, setTickHistory] = useState<number[]>([]);
    const [stake, setStake] = useState<string>('1');
    const [duration, setDuration] = useState<string>('5');
    const [durationUnit, setDurationUnit] = useState<string>('t');
    const [selectedTradeType, setSelectedTradeType] = useState<TradeType>(TRADE_TYPES[0]);
    const [proposalCall, setProposalCall] = useState<{ id: string; payout: number } | null>(null);
    const [proposalPut, setProposalPut] = useState<{ id: string; payout: number } | null>(null);
    const [isLoadingProposal, setIsLoadingProposal] = useState(false);
    const [trades, setTrades] = useState<TradeRecord[]>([]);
    const [buyStatus, setBuyStatus] = useState<{ type: 'CALL' | 'PUT'; state: 'loading' | 'success' | 'error'; message?: string } | null>(null);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [currency, setCurrency] = useState('USD');
    const [balance, setBalance] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [showSymbolList, setShowSymbolList] = useState(false);
    const [showHistory, setShowHistory] = useState(false);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const symbolDropdownRef = useRef<HTMLDivElement>(null);
    const tickSubscriptionRef = useRef<{ id?: string } | null>(null);
    const proposalCallSubRef = useRef<{ id?: string } | null>(null);
    const proposalPutSubRef = useRef<{ id?: string } | null>(null);
    const messageListenerRef = useRef<{ unsubscribe: () => void } | null>(null);
    const proposalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const buyStatusRef = useRef(buyStatus);
    buyStatusRef.current = buyStatus;
    const selectedSymbolRef = useRef(selectedSymbol);
    selectedSymbolRef.current = selectedSymbol;
    const currentPriceRef = useRef(currentPrice);
    currentPriceRef.current = currentPrice;

    const forgetSubscription = useCallback((sub_id: string | undefined) => {
        if (sub_id && api_base.api) {
            api_base.api.send({ forget: sub_id });
        }
    }, []);

    const handleMessage = useCallback((message: any) => {
        if (!message) return;

        if (message.msg_type === 'tick' && message.tick) {
            const rawPrice = message.tick.quote;
            const pipSize = message.tick.pip_size ?? 2;
            const newPrice = rawPrice?.toFixed(pipSize) ?? null;
            if (newPrice !== null) {
                setCurrentPrice(prev => {
                    if (prev && newPrice) {
                        setPriceDirection(parseFloat(newPrice) > parseFloat(prev) ? 'up' : 'down');
                        setPrevPrice(prev);
                    }
                    return newPrice;
                });
                setTickHistory(prev => {
                    const next = [...prev, rawPrice];
                    if (next.length > MAX_CHART_POINTS) return next.slice(next.length - MAX_CHART_POINTS);
                    return next;
                });
            }
        }

        if (message.msg_type === 'proposal' && message.proposal) {
            const { id, payout, contract_type } = message.proposal;
            if (contract_type === 'CALL' || contract_type === 'DIGITOVER' || contract_type === 'ONETOUCH') {
                setProposalCall({ id, payout: parseFloat(payout) });
            } else if (contract_type === 'PUT' || contract_type === 'DIGITUNDER' || contract_type === 'NOTOUCH') {
                setProposalPut({ id, payout: parseFloat(payout) });
            }
            setIsLoadingProposal(false);
        }

        if (message.msg_type === 'buy' && message.buy) {
            const { transaction_id, contract_id, buy_price, payout } = message.buy;
            const currentBuyStatus = buyStatusRef.current;
            setTrades(prev => [
                {
                    id: String(contract_id || transaction_id),
                    contract_type: currentBuyStatus?.type ?? 'CALL',
                    symbol: selectedSymbolRef.current,
                    stake: parseFloat(buy_price),
                    payout: parseFloat(payout),
                    entry_spot: parseFloat(currentPriceRef.current ?? '0'),
                    status: 'open',
                    time: new Date().toLocaleTimeString(),
                },
                ...prev.slice(0, 19),
            ]);
            setBuyStatus(prev => (prev ? { ...prev, state: 'success', message: 'Trade placed successfully!' } : null));
            setTimeout(() => setBuyStatus(null), 3000);
        }

        if (message.msg_type === 'balance' && message.balance) {
            setBalance(parseFloat(message.balance.balance).toFixed(2));
            setCurrency(message.balance.currency || 'USD');
        }

        if (message.error && message.echo_req?.buy) {
            setBuyStatus(prev => (prev ? { ...prev, state: 'error', message: message.error.message } : null));
            setTimeout(() => setBuyStatus(null), 5000);
        }

        if (message.msg_type === 'proposal_open_contract' && message.proposal_open_contract) {
            const poc = message.proposal_open_contract;
            if (poc.is_expired || poc.is_sold) {
                const profit = parseFloat(poc.profit ?? '0');
                setTrades(prev =>
                    prev.map(t =>
                        t.id === String(poc.contract_id)
                            ? { ...t, status: profit >= 0 ? 'won' : 'lost', profit }
                            : t
                    )
                );
            }
        }
    }, []);

    useEffect(() => {
        setIsAuthorized(api_base.is_authorized);
        if (api_base.active_symbols?.length) {
            const syms = api_base.active_symbols as ActiveSymbol[];
            setSymbols(syms);
            const defaultSym = syms.find(s => s.symbol === 'R_100') || syms[0];
            if (defaultSym) {
                setSelectedSymbol(defaultSym.symbol);
                setSelectedSymbolName(defaultSym.display_name);
                setIsMarketOpen(!!defaultSym.exchange_is_open);
            }
        }
        if (api_base.api) {
            const listener = api_base.api.onMessage().subscribe(handleMessage);
            messageListenerRef.current = listener;
        }
        return () => { messageListenerRef.current?.unsubscribe(); };
    }, []);

    useEffect(() => {
        messageListenerRef.current?.unsubscribe();
        if (api_base.api) {
            const listener = api_base.api.onMessage().subscribe(handleMessage);
            messageListenerRef.current = listener;
        }
    }, [handleMessage]);

    useEffect(() => {
        if (!api_base.api) return;
        forgetSubscription(tickSubscriptionRef.current?.id);
        tickSubscriptionRef.current = null;
        setCurrentPrice(null);
        setPrevPrice(null);
        setTickHistory([]);

        const sub = api_base.api.send({ ticks: selectedSymbol, subscribe: 1 }) as Promise<any>;
        if (sub && typeof sub.then === 'function') {
            sub.then((res: any) => {
                if (res?.subscription?.id) {
                    tickSubscriptionRef.current = { id: res.subscription.id };
                }
            });
        }
        return () => { forgetSubscription(tickSubscriptionRef.current?.id); };
    }, [selectedSymbol, forgetSubscription]);

    useEffect(() => {
        if (!api_base.api || !selectedSymbol) return;
        if (proposalTimerRef.current) clearTimeout(proposalTimerRef.current);

        proposalTimerRef.current = setTimeout(() => {
            forgetSubscription(proposalCallSubRef.current?.id);
            forgetSubscription(proposalPutSubRef.current?.id);
            setProposalCall(null);
            setProposalPut(null);

            const stakeNum = parseFloat(stake);
            if (isNaN(stakeNum) || stakeNum <= 0) return;
            const durNum = parseInt(duration);
            if (isNaN(durNum) || durNum <= 0) return;

            setIsLoadingProposal(true);

            const base_payload = {
                proposal: 1,
                amount: stakeNum,
                basis: 'stake',
                currency,
                duration: durNum,
                duration_unit: durationUnit,
                symbol: selectedSymbol,
                subscribe: 1,
            };

            const callSub = api_base.api?.send({ ...base_payload, contract_type: selectedTradeType.contract_call }) as Promise<any>;
            if (callSub?.then) callSub.then((res: any) => { if (res?.subscription?.id) proposalCallSubRef.current = { id: res.subscription.id }; });

            const putSub = api_base.api?.send({ ...base_payload, contract_type: selectedTradeType.contract_put }) as Promise<any>;
            if (putSub?.then) putSub.then((res: any) => { if (res?.subscription?.id) proposalPutSubRef.current = { id: res.subscription.id }; });
        }, 600);

        return () => { if (proposalTimerRef.current) clearTimeout(proposalTimerRef.current); };
    }, [selectedSymbol, stake, duration, durationUnit, currency, selectedTradeType, forgetSubscription]);

    // Draw canvas chart
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || tickHistory.length < 2) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const min = Math.min(...tickHistory);
        const max = Math.max(...tickHistory);
        const range = max - min || 1;

        const padY = 20;
        const padX = 8;

        // Grid lines
        ctx.strokeStyle = 'rgba(128,128,128,0.12)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = padY + ((h - padY * 2) / 4) * i;
            ctx.beginPath();
            ctx.moveTo(padX, y);
            ctx.lineTo(w - padX, y);
            ctx.stroke();
        }

        // Price line
        const points = tickHistory.map((price, i) => ({
            x: padX + (i / (tickHistory.length - 1)) * (w - padX * 2),
            y: padY + (1 - (price - min) / range) * (h - padY * 2),
        }));

        const lastPoint = points[points.length - 1];
        const prevPoint = points[points.length - 2];
        const isUp = lastPoint && prevPoint ? lastPoint.y <= prevPoint.y : true;

        // Gradient fill
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        if (isUp) {
            grad.addColorStop(0, 'rgba(76,175,80,0.25)');
            grad.addColorStop(1, 'rgba(76,175,80,0)');
        } else {
            grad.addColorStop(0, 'rgba(244,67,54,0.25)');
            grad.addColorStop(1, 'rgba(244,67,54,0)');
        }

        ctx.beginPath();
        ctx.moveTo(points[0].x, h);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(points[points.length - 1].x, h);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        // Line
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.strokeStyle = isUp ? '#4caf50' : '#f44336';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Last dot
        if (lastPoint) {
            ctx.beginPath();
            ctx.arc(lastPoint.x, lastPoint.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = isUp ? '#4caf50' : '#f44336';
            ctx.fill();
        }

        // Current price label
        if (lastPoint && currentPrice) {
            ctx.fillStyle = isUp ? '#4caf50' : '#f44336';
            ctx.font = 'bold 11px monospace';
            ctx.fillText(currentPrice, w - padX - 60, Math.max(padY + 12, lastPoint.y - 6));
        }
    }, [tickHistory, currentPrice]);

    const handleBuy = useCallback((contract_type: 'CALL' | 'PUT') => {
        if (!api_base.api || !isAuthorized) return;
        const proposal = contract_type === 'CALL' ? proposalCall : proposalPut;
        if (!proposal) return;
        setBuyStatus({ type: contract_type, state: 'loading' });
        api_base.api.send({ buy: proposal.id, price: parseFloat(stake) });
    }, [isAuthorized, proposalCall, proposalPut, stake]);

    const handleSymbolSelect = (sym: ActiveSymbol) => {
        setSelectedSymbol(sym.symbol);
        setSelectedSymbolName(sym.display_name);
        setIsMarketOpen(!!sym.exchange_is_open);
        setShowSymbolList(false);
        setSearchQuery('');
    };

    const handleTradeTypeSelect = (tt: TradeType) => {
        setSelectedTradeType(tt);
        setProposalCall(null);
        setProposalPut(null);
    };

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (symbolDropdownRef.current && !symbolDropdownRef.current.contains(e.target as Node)) {
                setShowSymbolList(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const filteredSymbols = symbols.filter(
        s =>
            s.display_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.symbol?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const grouped = filteredSymbols.reduce<Record<string, ActiveSymbol[]>>((acc, s) => {
        const key = s.market_display_name || s.market || 'Other';
        if (!acc[key]) acc[key] = [];
        acc[key].push(s);
        return acc;
    }, {});

    const durationUnitConfig = DURATION_UNITS.find(u => u.value === durationUnit) ?? DURATION_UNITS[0];
    const priceColorClass = priceDirection === 'up' ? 'dtrader__price--up' : priceDirection === 'down' ? 'dtrader__price--down' : '';

    const adjustStake = (delta: number) => {
        setStake(s => String(Math.max(0.35, parseFloat(s || '0') + delta).toFixed(2)));
    };

    return (
        <div className='dtrader'>
            {/* ── Top header: trade-type chips + account ── */}
            <div className='dtrader__header'>
                <div className='dtrader__trade-types'>
                    {TRADE_TYPES.map(tt => (
                        <button
                            key={tt.id}
                            className={`dtrader__type-chip ${selectedTradeType.id === tt.id ? 'dtrader__type-chip--active' : ''}`}
                            onClick={() => handleTradeTypeSelect(tt)}
                        >
                            <span className='dtrader__type-chip-icon'>{tt.icon}</span>
                            <span className='dtrader__type-chip-label'>{tt.label}</span>
                        </button>
                    ))}
                </div>
                <div className='dtrader__account-header'>
                    {isAuthorized && balance !== null ? (
                        <div className='dtrader__balance'>
                            <span className='dtrader__balance-label'>Balance</span>
                            <span className='dtrader__balance-value'>{currency} {balance}</span>
                        </div>
                    ) : (
                        <div className='dtrader__auth-notice'>Login to trade</div>
                    )}
                </div>
            </div>

            {/* ── Market selector bar ── */}
            <div className='dtrader__market-bar' ref={symbolDropdownRef}>
                <button
                    className={`dtrader__market-selector ${showSymbolList ? 'dtrader__market-selector--open' : ''}`}
                    onClick={() => setShowSymbolList(v => !v)}
                >
                    <div className='dtrader__market-info'>
                        <span className='dtrader__market-name'>{selectedSymbolName}</span>
                        {!isMarketOpen && <span className='dtrader__market-badge dtrader__market-badge--closed'>CLOSED</span>}
                    </div>
                    <svg className={`dtrader__market-chevron ${showSymbolList ? 'dtrader__market-chevron--up' : ''}`} width='16' height='16' viewBox='0 0 16 16' fill='none'>
                        <path d='M4 6l4 4 4-4' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'/>
                    </svg>
                </button>

                <div className='dtrader__current-spot'>
                    {currentPrice !== null ? (
                        <>
                            <span className={`dtrader__spot-price ${priceColorClass}`}>{currentPrice}</span>
                            <span className={`dtrader__spot-arrow ${priceColorClass}`}>
                                {priceDirection === 'up' ? '▲' : priceDirection === 'down' ? '▼' : ''}
                            </span>
                        </>
                    ) : (
                        <span className='dtrader__spot-loading'>
                            <span className='dtrader__pulse' />
                            Connecting…
                        </span>
                    )}
                </div>

                {/* Symbol dropdown */}
                {showSymbolList && (
                    <div className='dtrader__symbol-dropdown'>
                        <div className='dtrader__symbol-search-wrap'>
                            <input
                                type='text'
                                className='dtrader__symbol-search'
                                placeholder='Search markets…'
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className='dtrader__symbol-list'>
                            {Object.keys(grouped).length === 0 ? (
                                <div className='dtrader__symbol-empty'>No markets found</div>
                            ) : (
                                Object.entries(grouped).map(([market, syms]) => (
                                    <div key={market}>
                                        <div className='dtrader__symbol-group-label'>{market}</div>
                                        {syms.map(sym => (
                                            <div
                                                key={sym.symbol}
                                                className={`dtrader__symbol-item ${sym.symbol === selectedSymbol ? 'dtrader__symbol-item--active' : ''}`}
                                                onClick={() => handleSymbolSelect(sym)}
                                            >
                                                <span className='dtrader__symbol-item-name'>{sym.display_name}</span>
                                                <span className={`dtrader__symbol-item-status ${sym.exchange_is_open ? '' : 'dtrader__symbol-item-status--closed'}`}>
                                                    {sym.exchange_is_open ? '●' : '○'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* ── Main grid: chart left + params right ── */}
            <div className='dtrader__grid'>
                {/* Chart */}
                <div className='dtrader__chart-area'>
                    <div className='dtrader__chart-inner'>
                        {tickHistory.length >= 2 ? (
                            <canvas
                                ref={canvasRef}
                                className='dtrader__canvas'
                                width={800}
                                height={TICK_HEIGHT}
                                style={{ width: '100%', height: '100%' }}
                            />
                        ) : (
                            <div className='dtrader__chart-placeholder'>
                                <div className='dtrader__chart-bars'>
                                    {[40, 65, 50, 75, 55, 80, 60, 70, 45, 85].map((h, i) => (
                                        <div key={i} className='dtrader__chart-bar' style={{ height: `${h}%` }} />
                                    ))}
                                </div>
                                <span className='dtrader__chart-loading'>
                                    {currentPrice ? 'Receiving live data…' : 'Connecting to market…'}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Recent trades overlay toggle */}
                    <button className='dtrader__history-toggle' onClick={() => setShowHistory(v => !v)}>
                        {showHistory ? 'Hide Trades' : `Trades (${trades.length})`}
                    </button>

                    {/* Trade history panel (slide-in) */}
                    {showHistory && (
                        <div className='dtrader__history-panel'>
                            <div className='dtrader__history-header'>
                                <span className='dtrader__history-title'>Recent Trades</span>
                                <button className='dtrader__history-close' onClick={() => setShowHistory(false)}>✕</button>
                            </div>
                            {trades.length === 0 ? (
                                <div className='dtrader__history-empty'>No trades yet</div>
                            ) : (
                                trades.map(trade => (
                                    <div key={trade.id} className={`dtrader__trade-card dtrader__trade-card--${trade.status}`}>
                                        <div className='dtrader__trade-top'>
                                            <span className={`dtrader__trade-type dtrader__trade-type--${trade.contract_type === 'CALL' ? 'rise' : 'fall'}`}>
                                                {trade.contract_type === 'CALL' ? '▲' : '▼'} {trade.contract_type === 'CALL' ? selectedTradeType.call_label : selectedTradeType.put_label}
                                            </span>
                                            <span className='dtrader__trade-status'>
                                                {trade.status === 'open' && <span className='dtrader__trade-open-dot' />}
                                                {trade.status === 'open' ? 'Open' : trade.status === 'won' ? '✓ Won' : '✕ Lost'}
                                            </span>
                                        </div>
                                        <div className='dtrader__trade-bottom'>
                                            <span className='dtrader__trade-symbol'>{trade.symbol}</span>
                                            <span className='dtrader__trade-stake'>{currency} {trade.stake.toFixed(2)}</span>
                                            {trade.profit !== undefined && (
                                                <span className={`dtrader__trade-profit ${trade.profit >= 0 ? 'dtrader__trade-profit--pos' : 'dtrader__trade-profit--neg'}`}>
                                                    {trade.profit >= 0 ? '+' : ''}{trade.profit.toFixed(2)}
                                                </span>
                                            )}
                                            <span className='dtrader__trade-time'>{trade.time}</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>

                {/* Trade parameters panel */}
                <div className='dtrader__params'>
                    {/* Duration */}
                    <div className='dtrader__param-section'>
                        <div className='dtrader__param-label'>Duration</div>
                        <div className='dtrader__duration-wrap'>
                            <div className='dtrader__duration-unit-row'>
                                {DURATION_UNITS.map(u => (
                                    <button
                                        key={u.value}
                                        className={`dtrader__unit-chip ${durationUnit === u.value ? 'dtrader__unit-chip--active' : ''}`}
                                        onClick={() => setDurationUnit(u.value)}
                                    >
                                        {u.label}
                                    </button>
                                ))}
                            </div>
                            <div className='dtrader__duration-input-row'>
                                <button className='dtrader__adj-btn' onClick={() => setDuration(d => String(Math.max(durationUnitConfig.min, parseInt(d) - 1)))}>−</button>
                                <input
                                    type='number'
                                    className='dtrader__num-input'
                                    value={duration}
                                    min={durationUnitConfig.min}
                                    max={durationUnitConfig.max}
                                    onChange={e => setDuration(e.target.value)}
                                />
                                <button className='dtrader__adj-btn' onClick={() => setDuration(d => String(Math.min(durationUnitConfig.max, parseInt(d) + 1)))}>+</button>
                            </div>
                        </div>
                    </div>

                    <div className='dtrader__divider' />

                    {/* Stake */}
                    <div className='dtrader__param-section'>
                        <div className='dtrader__param-label'>Stake ({currency})</div>
                        <div className='dtrader__stake-row'>
                            <button className='dtrader__adj-btn' onClick={() => adjustStake(-0.5)}>−</button>
                            <input
                                type='number'
                                className='dtrader__num-input dtrader__num-input--stake'
                                value={stake}
                                min={0.35}
                                step={0.5}
                                onChange={e => setStake(e.target.value)}
                            />
                            <button className='dtrader__adj-btn' onClick={() => adjustStake(0.5)}>+</button>
                        </div>
                        <div className='dtrader__quick-stakes'>
                            {[1, 5, 10, 25].map(v => (
                                <button key={v} className='dtrader__quick-stake-btn' onClick={() => setStake(String(v))}>
                                    {v}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className='dtrader__divider' />

                    {/* Payout */}
                    <div className='dtrader__param-section'>
                        <div className='dtrader__param-label'>Payout</div>
                        <div className='dtrader__payout-row'>
                            <div className={`dtrader__payout-item dtrader__payout-item--${selectedTradeType.call_color}`}>
                                <span className='dtrader__payout-dir'>{selectedTradeType.call_label}</span>
                                <span className='dtrader__payout-val'>
                                    {isLoadingProposal ? (
                                        <span className='dtrader__payout-loading'>…</span>
                                    ) : proposalCall ? (
                                        `${currency} ${proposalCall.payout.toFixed(2)}`
                                    ) : '--'}
                                </span>
                            </div>
                            <div className={`dtrader__payout-item dtrader__payout-item--${selectedTradeType.put_color}`}>
                                <span className='dtrader__payout-dir'>{selectedTradeType.put_label}</span>
                                <span className='dtrader__payout-val'>
                                    {isLoadingProposal ? (
                                        <span className='dtrader__payout-loading'>…</span>
                                    ) : proposalPut ? (
                                        `${currency} ${proposalPut.payout.toFixed(2)}`
                                    ) : '--'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className='dtrader__spacer' />

                    {/* Status toast */}
                    {buyStatus && buyStatus.state !== 'loading' && (
                        <div className={`dtrader__toast dtrader__toast--${buyStatus.state}`}>
                            {buyStatus.state === 'success' ? '✓ ' : '✕ '}{buyStatus.message}
                        </div>
                    )}

                    {!isAuthorized && (
                        <div className='dtrader__login-hint'>Login to place trades</div>
                    )}

                    {/* Purchase buttons */}
                    <div className='dtrader__purchase-btns'>
                        <button
                            className={`dtrader__purchase-btn dtrader__purchase-btn--${selectedTradeType.call_color} ${(!proposalCall || !isAuthorized || (buyStatus?.type === 'CALL' && buyStatus.state === 'loading')) ? 'dtrader__purchase-btn--disabled' : ''}`}
                            onClick={() => handleBuy('CALL')}
                            disabled={!proposalCall || !isAuthorized || (buyStatus?.type === 'CALL' && buyStatus.state === 'loading')}
                        >
                            <div className='dtrader__purchase-btn-inner'>
                                <span className='dtrader__purchase-arrow'>▲</span>
                                <div className='dtrader__purchase-text'>
                                    <span className='dtrader__purchase-action'>{selectedTradeType.call_label}</span>
                                    {proposalCall && <span className='dtrader__purchase-payout'>{currency} {proposalCall.payout.toFixed(2)}</span>}
                                </div>
                                {buyStatus?.type === 'CALL' && buyStatus.state === 'loading' && <span className='dtrader__purchase-spinner' />}
                            </div>
                        </button>
                        <button
                            className={`dtrader__purchase-btn dtrader__purchase-btn--${selectedTradeType.put_color} ${(!proposalPut || !isAuthorized || (buyStatus?.type === 'PUT' && buyStatus.state === 'loading')) ? 'dtrader__purchase-btn--disabled' : ''}`}
                            onClick={() => handleBuy('PUT')}
                            disabled={!proposalPut || !isAuthorized || (buyStatus?.type === 'PUT' && buyStatus.state === 'loading')}
                        >
                            <div className='dtrader__purchase-btn-inner'>
                                <span className='dtrader__purchase-arrow'>▼</span>
                                <div className='dtrader__purchase-text'>
                                    <span className='dtrader__purchase-action'>{selectedTradeType.put_label}</span>
                                    {proposalPut && <span className='dtrader__purchase-payout'>{currency} {proposalPut.payout.toFixed(2)}</span>}
                                </div>
                                {buyStatus?.type === 'PUT' && buyStatus.state === 'loading' && <span className='dtrader__purchase-spinner' />}
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DTrader;
