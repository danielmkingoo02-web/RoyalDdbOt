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

const DURATION_UNITS = [
    { label: 'Ticks', value: 't', min: 1, max: 10 },
    { label: 'Minutes', value: 'm', min: 1, max: 60 },
];

const DTrader = () => {
    const [symbols, setSymbols] = useState<ActiveSymbol[]>([]);
    const [selectedSymbol, setSelectedSymbol] = useState<string>('R_100');
    const [selectedSymbolName, setSelectedSymbolName] = useState<string>('Volatility 100 Index');
    const [currentPrice, setCurrentPrice] = useState<string | null>(null);
    const [prevPrice, setPrevPrice] = useState<string | null>(null);
    const [priceDirection, setPriceDirection] = useState<'up' | 'down' | null>(null);
    const [stake, setStake] = useState<string>('1');
    const [duration, setDuration] = useState<string>('5');
    const [durationUnit, setDurationUnit] = useState<string>('t');
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

    const tickSubscriptionRef = useRef<{ id?: string } | null>(null);
    const proposalCallSubRef = useRef<{ id?: string } | null>(null);
    const proposalPutSubRef = useRef<{ id?: string } | null>(null);
    const messageListenerRef = useRef<{ unsubscribe: () => void } | null>(null);
    const proposalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Forget a subscription by id
    const forgetSubscription = useCallback((sub_id: string | undefined) => {
        if (sub_id && api_base.api) {
            api_base.api.send({ forget: sub_id });
        }
    }, []);

    // Handle incoming WebSocket messages
    const handleMessage = useCallback((message: any) => {
        if (!message) return;

        if (message.msg_type === 'tick' && message.tick) {
            const newPrice = message.tick.quote?.toFixed(2) ?? null;
            setCurrentPrice(prev => {
                if (prev && newPrice) {
                    setPriceDirection(parseFloat(newPrice) > parseFloat(prev) ? 'up' : 'down');
                    setPrevPrice(prev);
                }
                return newPrice;
            });
        }

        if (message.msg_type === 'proposal' && message.proposal) {
            const { id, payout, contract_type } = message.proposal;
            if (contract_type === 'CALL') {
                setProposalCall({ id, payout: parseFloat(payout) });
            } else if (contract_type === 'PUT') {
                setProposalPut({ id, payout: parseFloat(payout) });
            }
            setIsLoadingProposal(false);
        }

        if (message.msg_type === 'buy' && message.buy) {
            const { transaction_id, contract_id, buy_price, payout } = message.buy;
            setTrades(prev => [
                {
                    id: String(contract_id || transaction_id),
                    contract_type: buyStatus?.type ?? 'CALL',
                    symbol: selectedSymbol,
                    stake: parseFloat(buy_price),
                    payout: parseFloat(payout),
                    entry_spot: parseFloat(currentPrice ?? '0'),
                    status: 'open',
                    time: new Date().toLocaleTimeString(),
                },
                ...prev.slice(0, 19),
            ]);
            setBuyStatus(prev => (prev ? { ...prev, state: 'success', message: 'Trade placed!' } : null));
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
    }, [buyStatus, selectedSymbol, currentPrice]);

    // Initialize: load symbols, set up listener
    useEffect(() => {
        setIsAuthorized(api_base.is_authorized);

        if (api_base.active_symbols?.length) {
            setSymbols(api_base.active_symbols as ActiveSymbol[]);
        }

        // Set up global message listener
        if (api_base.api) {
            const listener = api_base.api.onMessage().subscribe(handleMessage);
            messageListenerRef.current = listener;
        }

        return () => {
            messageListenerRef.current?.unsubscribe();
        };
    }, []);

    // Re-attach message listener when handleMessage changes
    useEffect(() => {
        messageListenerRef.current?.unsubscribe();
        if (api_base.api) {
            const listener = api_base.api.onMessage().subscribe(handleMessage);
            messageListenerRef.current = listener;
        }
    }, [handleMessage]);

    // Subscribe to ticks when symbol changes
    useEffect(() => {
        if (!api_base.api) return;

        // Forget old tick subscription
        forgetSubscription(tickSubscriptionRef.current?.id);
        tickSubscriptionRef.current = null;
        setCurrentPrice(null);
        setPrevPrice(null);

        // Subscribe to new symbol
        const sub = api_base.api.send({ ticks: selectedSymbol, subscribe: 1 }) as Promise<any>;
        if (sub && typeof sub.then === 'function') {
            sub.then((res: any) => {
                if (res?.subscription?.id) {
                    tickSubscriptionRef.current = { id: res.subscription.id };
                }
            });
        }

        return () => {
            forgetSubscription(tickSubscriptionRef.current?.id);
        };
    }, [selectedSymbol, forgetSubscription]);

    // Subscribe to proposals when inputs change
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

            const callSub = api_base.api?.send({ ...base_payload, contract_type: 'CALL' }) as Promise<any>;
            if (callSub?.then) {
                callSub.then((res: any) => {
                    if (res?.subscription?.id) proposalCallSubRef.current = { id: res.subscription.id };
                });
            }

            const putSub = api_base.api?.send({ ...base_payload, contract_type: 'PUT' }) as Promise<any>;
            if (putSub?.then) {
                putSub.then((res: any) => {
                    if (res?.subscription?.id) proposalPutSubRef.current = { id: res.subscription.id };
                });
            }
        }, 600);

        return () => {
            if (proposalTimerRef.current) clearTimeout(proposalTimerRef.current);
        };
    }, [selectedSymbol, stake, duration, durationUnit, currency, forgetSubscription]);

    const handleBuy = useCallback(
        (contract_type: 'CALL' | 'PUT') => {
            if (!api_base.api || !isAuthorized) return;
            const proposal = contract_type === 'CALL' ? proposalCall : proposalPut;
            if (!proposal) return;

            setBuyStatus({ type: contract_type, state: 'loading' });
            api_base.api.send({
                buy: proposal.id,
                price: parseFloat(stake),
            });
        },
        [isAuthorized, proposalCall, proposalPut, stake]
    );

    const handleSymbolSelect = (sym: ActiveSymbol) => {
        setSelectedSymbol(sym.symbol);
        setSelectedSymbolName(sym.display_name);
        setShowSymbolList(false);
        setSearchQuery('');
    };

    const filteredSymbols = symbols.filter(
        s =>
            s.display_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.symbol?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const durationUnitConfig = DURATION_UNITS.find(u => u.value === durationUnit) ?? DURATION_UNITS[0];

    const priceColorClass = priceDirection === 'up' ? 'dtrader__price--up' : priceDirection === 'down' ? 'dtrader__price--down' : '';

    return (
        <div className='dtrader'>
            {/* Header bar */}
            <div className='dtrader__header'>
                <div className='dtrader__header-left'>
                    <div className='dtrader__symbol-selector' onClick={() => setShowSymbolList(v => !v)}>
                        <span className='dtrader__symbol-name'>{selectedSymbolName}</span>
                        <span className='dtrader__symbol-code'>{selectedSymbol}</span>
                        <span className='dtrader__chevron'>{showSymbolList ? '▲' : '▼'}</span>
                    </div>
                    {currentPrice !== null && (
                        <div className={`dtrader__live-price ${priceColorClass}`}>
                            <span className='dtrader__live-price-label'>Live Price</span>
                            <span className='dtrader__live-price-value'>{currentPrice}</span>
                            <span className='dtrader__live-price-arrow'>{priceDirection === 'up' ? '▲' : priceDirection === 'down' ? '▼' : ''}</span>
                        </div>
                    )}
                    {currentPrice === null && (
                        <div className='dtrader__live-price dtrader__live-price--loading'>
                            <span className='dtrader__pulse' />
                            <span>Connecting...</span>
                        </div>
                    )}
                </div>
                <div className='dtrader__header-right'>
                    {isAuthorized && balance !== null && (
                        <div className='dtrader__balance'>
                            <span className='dtrader__balance-label'>Balance</span>
                            <span className='dtrader__balance-value'>{currency} {balance}</span>
                        </div>
                    )}
                    {!isAuthorized && (
                        <div className='dtrader__auth-notice'>
                            Log in to place trades
                        </div>
                    )}
                </div>
            </div>

            {/* Symbol dropdown */}
            {showSymbolList && (
                <div className='dtrader__symbol-dropdown'>
                    <div className='dtrader__symbol-search-wrap'>
                        <input
                            type='text'
                            className='dtrader__symbol-search'
                            placeholder='Search markets...'
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div className='dtrader__symbol-list'>
                        {filteredSymbols.length === 0 && (
                            <div className='dtrader__symbol-empty'>No markets found</div>
                        )}
                        {filteredSymbols.map(sym => (
                            <div
                                key={sym.symbol}
                                className={`dtrader__symbol-item ${sym.symbol === selectedSymbol ? 'dtrader__symbol-item--active' : ''}`}
                                onClick={() => handleSymbolSelect(sym)}
                            >
                                <span className='dtrader__symbol-item-name'>{sym.display_name}</span>
                                <span className='dtrader__symbol-item-code'>{sym.symbol}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className='dtrader__body'>
                {/* Trade form */}
                <div className='dtrader__form'>
                    <h3 className='dtrader__form-title'>Place Trade</h3>

                    {/* Duration */}
                    <div className='dtrader__field'>
                        <label className='dtrader__label'>Duration</label>
                        <div className='dtrader__duration-row'>
                            <input
                                type='number'
                                className='dtrader__input'
                                value={duration}
                                min={durationUnitConfig.min}
                                max={durationUnitConfig.max}
                                onChange={e => setDuration(e.target.value)}
                            />
                            <div className='dtrader__duration-units'>
                                {DURATION_UNITS.map(u => (
                                    <button
                                        key={u.value}
                                        className={`dtrader__unit-btn ${durationUnit === u.value ? 'dtrader__unit-btn--active' : ''}`}
                                        onClick={() => setDurationUnit(u.value)}
                                    >
                                        {u.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Stake */}
                    <div className='dtrader__field'>
                        <label className='dtrader__label'>Stake ({currency})</label>
                        <div className='dtrader__stake-row'>
                            <button
                                className='dtrader__stake-adj'
                                onClick={() => setStake(s => String(Math.max(0.35, parseFloat(s) - 0.5).toFixed(2)))}
                            >−</button>
                            <input
                                type='number'
                                className='dtrader__input dtrader__input--stake'
                                value={stake}
                                min={0.35}
                                step={0.5}
                                onChange={e => setStake(e.target.value)}
                            />
                            <button
                                className='dtrader__stake-adj'
                                onClick={() => setStake(s => String((parseFloat(s) + 0.5).toFixed(2)))}
                            >+</button>
                        </div>
                    </div>

                    {/* Payout */}
                    <div className='dtrader__payout-row'>
                        <div className='dtrader__payout-item'>
                            <span className='dtrader__payout-label'>Rise Payout</span>
                            <span className='dtrader__payout-value dtrader__payout-value--rise'>
                                {isLoadingProposal ? '...' : proposalCall ? `${currency} ${proposalCall.payout.toFixed(2)}` : '--'}
                            </span>
                        </div>
                        <div className='dtrader__payout-item'>
                            <span className='dtrader__payout-label'>Fall Payout</span>
                            <span className='dtrader__payout-value dtrader__payout-value--fall'>
                                {isLoadingProposal ? '...' : proposalPut ? `${currency} ${proposalPut.payout.toFixed(2)}` : '--'}
                            </span>
                        </div>
                    </div>

                    {/* Buy buttons */}
                    <div className='dtrader__buy-row'>
                        <button
                            className={`dtrader__buy-btn dtrader__buy-btn--rise ${(!proposalCall || !isAuthorized || (buyStatus?.type === 'CALL' && buyStatus.state === 'loading')) ? 'dtrader__buy-btn--disabled' : ''}`}
                            onClick={() => handleBuy('CALL')}
                            disabled={!proposalCall || !isAuthorized || (buyStatus?.type === 'CALL' && buyStatus.state === 'loading')}
                        >
                            <span className='dtrader__buy-arrow'>▲</span>
                            <span className='dtrader__buy-label'>Rise</span>
                            {buyStatus?.type === 'CALL' && buyStatus.state === 'loading' && <span className='dtrader__buy-spinner' />}
                        </button>
                        <button
                            className={`dtrader__buy-btn dtrader__buy-btn--fall ${(!proposalPut || !isAuthorized || (buyStatus?.type === 'PUT' && buyStatus.state === 'loading')) ? 'dtrader__buy-btn--disabled' : ''}`}
                            onClick={() => handleBuy('PUT')}
                            disabled={!proposalPut || !isAuthorized || (buyStatus?.type === 'PUT' && buyStatus.state === 'loading')}
                        >
                            <span className='dtrader__buy-arrow'>▼</span>
                            <span className='dtrader__buy-label'>Fall</span>
                            {buyStatus?.type === 'PUT' && buyStatus.state === 'loading' && <span className='dtrader__buy-spinner' />}
                        </button>
                    </div>

                    {/* Status message */}
                    {buyStatus && buyStatus.state !== 'loading' && (
                        <div className={`dtrader__status dtrader__status--${buyStatus.state}`}>
                            {buyStatus.state === 'success' ? '✓ ' : '✕ '}{buyStatus.message}
                        </div>
                    )}

                    {!isAuthorized && (
                        <p className='dtrader__login-hint'>You must be logged in to place trades.</p>
                    )}
                </div>

                {/* Trade history */}
                <div className='dtrader__history'>
                    <h3 className='dtrader__history-title'>Recent Trades</h3>
                    {trades.length === 0 && (
                        <div className='dtrader__history-empty'>
                            <span>No trades yet</span>
                            <span className='dtrader__history-hint'>Place a trade to see it here</span>
                        </div>
                    )}
                    {trades.map(trade => (
                        <div
                            key={trade.id}
                            className={`dtrader__trade-card dtrader__trade-card--${trade.status}`}
                        >
                            <div className='dtrader__trade-top'>
                                <span className={`dtrader__trade-type dtrader__trade-type--${trade.contract_type === 'CALL' ? 'rise' : 'fall'}`}>
                                    {trade.contract_type === 'CALL' ? '▲ Rise' : '▼ Fall'}
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
                    ))}
                </div>
            </div>
        </div>
    );
};

export default DTrader;
