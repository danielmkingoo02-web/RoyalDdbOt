import React, { useCallback, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { SmartChart } from '@deriv/deriv-charts';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import ToolbarWidgets from '../chart/toolbar-widgets';
import '@deriv/deriv-charts/dist/smartcharts.css';
import './dtrader.scss';

/* ── Types ──────────────────────────────────────────────────── */
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
    contract_type: string;
    symbol: string;
    stake: number;
    payout: number;
    entry_spot: number;
    status: 'open' | 'won' | 'lost';
    profit?: number;
    time: string;
    trade_label: string;
};

type TradeType = {
    id: string;
    label: string;
    icon: string;
    contract_call: string;
    contract_put: string;
    call_label: string;
    put_label: string;
    call_color: string;
    put_color: string;
    has_barrier?: boolean;
    has_digit?: boolean;
    needs_barrier?: boolean;
    /* 'updown' = classic call/put contracts (Rise/Fall-like); the rest are the
       advanced Deriv contract families, each with their own parameter set. */
    family?: 'updown' | 'accumulator' | 'multiplier' | 'turbo' | 'vanilla';
    single_sided?: boolean; // true for contracts with only a "call" side (e.g. Accumulators)
};

/* ── Trade type catalogue ───────────────────────────────────── */
const TRADE_TYPES: TradeType[] = [
    {
        id: 'rise_fall',
        label: 'Rise/Fall',
        icon: '↕',
        contract_call: 'CALL',
        contract_put: 'PUT',
        call_label: 'Rise',
        put_label: 'Fall',
        call_color: 'rise',
        put_color: 'fall',
    },
    {
        id: 'higher_lower',
        label: 'Higher/Lower',
        icon: '⇅',
        contract_call: 'CALL',
        contract_put: 'PUT',
        call_label: 'Higher',
        put_label: 'Lower',
        call_color: 'higher',
        put_color: 'lower',
        has_barrier: true,
    },
    {
        id: 'touch_no_touch',
        label: 'Touch/No Touch',
        icon: '⊙',
        contract_call: 'ONETOUCH',
        contract_put: 'NOTOUCH',
        call_label: 'Touch',
        put_label: 'No Touch',
        call_color: 'touch',
        put_color: 'notouch',
        has_barrier: true,
    },
    {
        id: 'over_under',
        label: 'Over/Under',
        icon: '≷',
        contract_call: 'DIGITOVER',
        contract_put: 'DIGITUNDER',
        call_label: 'Over',
        put_label: 'Under',
        call_color: 'over',
        put_color: 'under',
        has_digit: true,
    },
    {
        id: 'matches_differs',
        label: 'Matches/Differs',
        icon: '≈',
        contract_call: 'DIGITMATCH',
        contract_put: 'DIGITDIFF',
        call_label: 'Matches',
        put_label: 'Differs',
        call_color: 'match',
        put_color: 'differ',
        has_digit: true,
    },
    {
        id: 'even_odd',
        label: 'Even/Odd',
        icon: '⊕',
        contract_call: 'DIGITEVEN',
        contract_put: 'DIGITODD',
        call_label: 'Even',
        put_label: 'Odd',
        call_color: 'even',
        put_color: 'odd',
        has_digit: true,
    },
    {
        id: 'accumulators',
        label: 'Accumulators',
        icon: '📈',
        contract_call: 'ACCU',
        contract_put: '',
        call_label: 'Buy',
        put_label: '',
        call_color: 'accu',
        put_color: 'accu',
        family: 'accumulator',
        single_sided: true,
    },
    {
        id: 'multipliers',
        label: 'Multipliers',
        icon: '✕',
        contract_call: 'MULTUP',
        contract_put: 'MULTDOWN',
        call_label: 'Up',
        put_label: 'Down',
        call_color: 'multup',
        put_color: 'multdown',
        family: 'multiplier',
    },
    {
        id: 'turbos',
        label: 'Turbos',
        icon: '🚀',
        contract_call: 'TURBOSLONG',
        contract_put: 'TURBOSSHORT',
        call_label: 'Long',
        put_label: 'Short',
        call_color: 'turboslong',
        put_color: 'turbosshort',
        has_barrier: true,
        family: 'turbo',
    },
    {
        id: 'vanillas',
        label: 'Vanillas',
        icon: '🎯',
        contract_call: 'VANILLALONGCALL',
        contract_put: 'VANILLALONGPUT',
        call_label: 'Call',
        put_label: 'Put',
        call_color: 'vanillacall',
        put_color: 'vanillaput',
        has_barrier: true,
        family: 'vanilla',
    },
];

const GROWTH_RATES = [0.01, 0.02, 0.03, 0.04, 0.05];
const MULTIPLIER_OPTIONS = [20, 50, 100, 200, 300, 500, 1000];

const DURATION_UNITS = [
    { label: 'Ticks', short: 't', value: 't', min: 5, max: 10 },
    { label: 'Min',   short: 'm', value: 'm', min: 1, max: 60 },
    { label: 'Hours', short: 'h', value: 'h', min: 1, max: 24 },
];

const DIGIT_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/* ── SmartChart subscription map (module-level, keyed by sub ID) ─── */
const chartSubscriptions: Record<string, { unsubscribe?: () => void } | null> = {};

/* ── getMarketsOrder (same as chart-store) ──────────────────── */
const getMarketsOrder = (active_symbols: { market: string; display_name: string }[]) => {
    const synthetic_index = 'synthetic_index';
    const has_synthetic_index = !!active_symbols.find(s => s.market === synthetic_index);
    return active_symbols
        .slice()
        .sort((a, b) => (a.display_name < b.display_name ? -1 : 1))
        .map(s => s.market)
        .reduce(
            (arr: string[], market: string) => {
                if (arr.indexOf(market) === -1) arr.push(market);
                return arr;
            },
            has_synthetic_index ? [synthetic_index] : []
        );
};

/* ── Component ──────────────────────────────────────────────── */
const DTrader = observer(() => {
    /* App-level stores for theme/language */
    const { common, ui } = useStore();

    /* Symbol state */
    const [symbols, setSymbols] = useState<ActiveSymbol[]>([]);
    const [selectedSymbol, setSelectedSymbol] = useState<string>('R_100');
    const [selectedSymbolName, setSelectedSymbolName] = useState<string>('Volatility 100 Index');
    const [isMarketOpen, setIsMarketOpen] = useState<boolean>(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [showSymbolList, setShowSymbolList] = useState(false);

    /* Price / tick state */
    const [currentPrice, setCurrentPrice] = useState<string | null>(null);
    const [prevPrice, setPrevPrice] = useState<string | null>(null);
    const [priceDirection, setPriceDirection] = useState<'up' | 'down' | null>(null);

    /* Chart state */
    const [chartType, setChartType] = useState('line');
    const [granularity, setGranularity] = useState(0);

    /* Trade params */
    const [selectedTradeType, setSelectedTradeType] = useState<TradeType>(TRADE_TYPES[0]);
    const [stake, setStake] = useState<string>('1');
    const [duration, setDuration] = useState<string>('5');
    const [durationUnit, setDurationUnit] = useState<string>('t');
    const [selectedDigit, setSelectedDigit] = useState<number>(5);
    const [barrier, setBarrier] = useState<string>('+1'); // for higher_lower / touch_no_touch / turbos / vanillas
    const [growthRate, setGrowthRate] = useState<number>(0.03); // accumulators
    const [multiplier, setMultiplier] = useState<number>(100); // multipliers
    const [takeProfit, setTakeProfit] = useState<string>(''); // accumulators / multipliers
    const [stopLoss, setStopLoss] = useState<string>(''); // multipliers

    /* Proposal / buy state */
    const [proposalCall, setProposalCall] = useState<{ id: string; payout: number } | null>(null);
    const [proposalPut, setProposalPut] = useState<{ id: string; payout: number } | null>(null);
    const [isLoadingProposal, setIsLoadingProposal] = useState(false);
    const [buyStatus, setBuyStatus] = useState<{
        type: string;
        state: 'loading' | 'success' | 'error';
        message?: string;
    } | null>(null);

    /* Account state */
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [currency, setCurrency] = useState('USD');
    const [balance, setBalance] = useState<string | null>(null);

    /* Positions panel */
    const [trades, setTrades] = useState<TradeRecord[]>([]);
    const [showPositions, setShowPositions] = useState(false);

    /* Refs */
    const symbolDropdownRef = useRef<HTMLDivElement>(null);
    const proposalCallSubRef = useRef<string | null>(null);
    const proposalPutSubRef = useRef<string | null>(null);
    const tickSubIdRef = useRef<string | null>(null);          // fix: track tick sub ID
    const chartSubIdRef = useRef<string | null>(null);         // fix: per-component chart sub
    const proposalTokenRef = useRef<number>(0);                // fix: staleness guard
    const messageListenerRef = useRef<{ unsubscribe: () => void } | null>(null);
    const proposalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const buyStatusRef = useRef(buyStatus);
    buyStatusRef.current = buyStatus;
    const selectedSymbolRef = useRef(selectedSymbol);
    selectedSymbolRef.current = selectedSymbol;
    const currentPriceRef = useRef(currentPrice);
    currentPriceRef.current = currentPrice;
    const selectedTradeTypeRef = useRef(selectedTradeType);
    selectedTradeTypeRef.current = selectedTradeType;

    /* ── SmartChart request functions ─────────────────────── */
    const requestAPI = useCallback((req: any) => {
        return api_base.api?.send(req);
    }, []);

    const requestForgetStream = useCallback((subscription_id: string) => {
        if (!subscription_id) return;
        if (chartSubscriptions[subscription_id]) {
            chartSubscriptions[subscription_id]?.unsubscribe?.();
            chartSubscriptions[subscription_id] = null;
        }
        api_base.api?.send({ forget: subscription_id });
    }, []);

    const requestSubscribe = useCallback(
        async (req: any, callback: (data: any) => void) => {
            try {
                // Forget only the previous chart subscription for this component
                if (chartSubIdRef.current) requestForgetStream(chartSubIdRef.current);
                const history = await api_base.api?.send(req);
                if (!history) return;
                const newSubId: string | null = history?.subscription?.id ?? null;
                chartSubIdRef.current = newSubId;
                callback(history);
                if (req.subscribe === 1 && newSubId) {
                    // Fix: filter onMessage to this subscription's ID only
                    chartSubscriptions[newSubId] = api_base.api
                        ?.onMessage()
                        ?.subscribe(({ data }: { data: any }) => {
                            // Only forward messages belonging to this subscription
                            const incomingSubId = data?.subscription?.id ?? data?.tick?.id ?? null;
                            if (!incomingSubId || incomingSubId === newSubId) {
                                callback(data);
                            }
                        });
                }
            } catch {
                callback([]);
            }
        },
        [requestForgetStream]
    );

    /* ── Message handler ─────────────────────────────────── */
    const handleMessage = useCallback((message: any) => {
        if (!message) return;

        /* Tick — only for the active tick subscription */
        if (message.msg_type === 'tick' && message.tick) {
            const incomingSubId = message.tick.id ?? message.subscription?.id ?? null;
            // Accept if sub IDs match or we have no ID to compare (first tick)
            if (incomingSubId && tickSubIdRef.current && incomingSubId !== tickSubIdRef.current) return;
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
            }
        }

        /* Proposal — only for current subscriptions; ignore stale ones */
        if (message.msg_type === 'proposal' && message.proposal) {
            const { id, payout, ask_price, contract_type } = message.proposal;
            const value = parseFloat(payout ?? ask_price ?? '0');
            const subId = message.subscription?.id;
            const tt = selectedTradeTypeRef.current;
            // Route by contract_type, then reject genuinely stale messages whose
            // subscription id no longer matches the currently tracked subscription
            // for that side (subscription.id stays constant across streamed updates,
            // unlike proposal.id which changes on every price tick).
            if (contract_type === tt.contract_call) {
                if (subId && proposalCallSubRef.current && subId !== proposalCallSubRef.current) return;
                setProposalCall({ id, payout: value });
                setIsLoadingProposal(false);
            } else if (tt.contract_put && contract_type === tt.contract_put) {
                if (subId && proposalPutSubRef.current && subId !== proposalPutSubRef.current) return;
                setProposalPut({ id, payout: value });
                setIsLoadingProposal(false);
            }
        }

        /* Buy confirmation */
        if (message.msg_type === 'buy' && message.buy) {
            const { transaction_id, contract_id, buy_price, payout } = message.buy;
            const currentBuyStatus = buyStatusRef.current;
            setTrades(prev => [
                {
                    id: String(contract_id || transaction_id),
                    contract_type: currentBuyStatus?.type ?? '',
                    symbol: selectedSymbolRef.current,
                    stake: parseFloat(buy_price),
                    payout: parseFloat(payout),
                    entry_spot: parseFloat(currentPriceRef.current ?? '0'),
                    status: 'open',
                    time: new Date().toLocaleTimeString(),
                    trade_label:
                        currentBuyStatus?.type === selectedTradeTypeRef.current.contract_call
                            ? selectedTradeTypeRef.current.call_label
                            : selectedTradeTypeRef.current.put_label,
                },
                ...prev.slice(0, 19),
            ]);
            setBuyStatus(prev => (prev ? { ...prev, state: 'success', message: 'Trade placed!' } : null));
            setTimeout(() => setBuyStatus(null), 3000);
        }

        /* Balance */
        if (message.msg_type === 'balance' && message.balance) {
            setBalance(parseFloat(message.balance.balance).toFixed(2));
            setCurrency(message.balance.currency || 'USD');
        }

        /* Buy error */
        if (message.error && message.echo_req?.buy) {
            setBuyStatus(prev =>
                prev ? { ...prev, state: 'error', message: message.error.message } : null
            );
            setTimeout(() => setBuyStatus(null), 5000);
        }

        /* Contract result */
        if (message.msg_type === 'proposal_open_contract' && message.proposal_open_contract) {
            const poc = message.proposal_open_contract;
            if (poc.is_expired || poc.is_sold) {
                const profit = parseFloat(poc.profit ?? '0');
                setTrades(prev =>
                    prev.map(t =>
                        t.id === String(poc.contract_id) ? { ...t, status: profit >= 0 ? 'won' : 'lost', profit } : t
                    )
                );
            }
        }
    }, []);

    /* ── Init ─────────────────────────────────────────────── */
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
            messageListenerRef.current = api_base.api.onMessage().subscribe(handleMessage);
        }
        return () => {
            messageListenerRef.current?.unsubscribe();
            // Fix: forget chart, tick and proposal subscriptions on unmount
            if (chartSubIdRef.current) { requestForgetStream(chartSubIdRef.current); chartSubIdRef.current = null; }
            if (tickSubIdRef.current) { api_base.api?.send({ forget: tickSubIdRef.current }); tickSubIdRef.current = null; }
            if (proposalCallSubRef.current) { api_base.api?.send({ forget: proposalCallSubRef.current }); proposalCallSubRef.current = null; }
            if (proposalPutSubRef.current) { api_base.api?.send({ forget: proposalPutSubRef.current }); proposalPutSubRef.current = null; }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* Re-subscribe message listener when handleMessage changes */
    useEffect(() => {
        messageListenerRef.current?.unsubscribe();
        if (api_base.api) {
            messageListenerRef.current = api_base.api.onMessage().subscribe(handleMessage);
        }
    }, [handleMessage]);

    /* Tick subscription — forget old sub before subscribing to new symbol */
    useEffect(() => {
        if (!api_base.api) return;
        setCurrentPrice(null);
        setPrevPrice(null);
        // Forget previous tick stream
        if (tickSubIdRef.current) {
            api_base.api.send({ forget: tickSubIdRef.current });
            tickSubIdRef.current = null;
        }
        (api_base.api.send({ ticks: selectedSymbol, subscribe: 1 }) as Promise<any>)?.then((res: any) => {
            if (res?.subscription?.id) tickSubIdRef.current = res.subscription.id;
        });
        return () => {
            if (tickSubIdRef.current) {
                api_base.api?.send({ forget: tickSubIdRef.current });
                tickSubIdRef.current = null;
            }
        };
    }, [selectedSymbol]);

    /* Proposal subscription — token guards against staleness */
    useEffect(() => {
        if (!api_base.api || !selectedSymbol) return;
        if (proposalTimerRef.current) clearTimeout(proposalTimerRef.current);

        proposalTimerRef.current = setTimeout(() => {
            // Increment token; closes over captured value for this request cycle
            const token = ++proposalTokenRef.current;

            // Forget previous proposals
            if (proposalCallSubRef.current) { api_base.api?.send({ forget: proposalCallSubRef.current }); proposalCallSubRef.current = null; }
            if (proposalPutSubRef.current)  { api_base.api?.send({ forget: proposalPutSubRef.current });  proposalPutSubRef.current = null; }
            setProposalCall(null);
            setProposalPut(null);

            const stakeNum = parseFloat(stake);
            if (isNaN(stakeNum) || stakeNum <= 0) return;

            const family = selectedTradeType.family ?? 'updown';
            const needsDuration = family === 'updown' || family === 'turbo' || family === 'vanilla';
            const durNum = parseInt(duration);
            if (needsDuration && (isNaN(durNum) || durNum <= 0)) return;

            setIsLoadingProposal(true);

            const base: any = {
                proposal: 1,
                amount: stakeNum,
                basis: 'stake',
                currency,
                symbol: selectedSymbol,
                subscribe: 1,
            };

            let callPayload: any;
            let putPayload: any | null = null;

            if (family === 'accumulator') {
                callPayload = { ...base, contract_type: selectedTradeType.contract_call, growth_rate: growthRate };
                const tp = parseFloat(takeProfit);
                if (!isNaN(tp) && tp > 0) callPayload.limit_order = { take_profit: tp };
            } else if (family === 'multiplier') {
                const limit_order: any = {};
                const tp = parseFloat(takeProfit);
                const sl = parseFloat(stopLoss);
                if (!isNaN(tp) && tp > 0) limit_order.take_profit = tp;
                if (!isNaN(sl) && sl > 0) limit_order.stop_loss = sl;
                const hasLimit = Object.keys(limit_order).length > 0;
                callPayload = {
                    ...base,
                    contract_type: selectedTradeType.contract_call,
                    multiplier,
                    ...(hasLimit ? { limit_order } : {}),
                };
                putPayload = {
                    ...base,
                    contract_type: selectedTradeType.contract_put,
                    multiplier,
                    ...(hasLimit ? { limit_order } : {}),
                };
            } else if (family === 'turbo' || family === 'vanilla') {
                const payload = { ...base, duration: durNum, duration_unit: durationUnit, barrier };
                callPayload = { ...payload, contract_type: selectedTradeType.contract_call };
                putPayload = { ...payload, contract_type: selectedTradeType.contract_put };
            } else {
                // 'updown' family — Rise/Fall, Higher/Lower, Touch/No Touch, Over/Under, Matches/Differs, Even/Odd
                const isDigit = selectedTradeType.has_digit;
                const payload = isDigit
                    ? { ...base, duration: durNum, duration_unit: 't' }
                    : { ...base, duration: durNum, duration_unit: durationUnit };

                callPayload = { ...payload, contract_type: selectedTradeType.contract_call };
                putPayload = { ...payload, contract_type: selectedTradeType.contract_put };

                if (isDigit && selectedTradeType.id !== 'even_odd') {
                    callPayload.barrier = selectedDigit;
                    putPayload.barrier = selectedDigit;
                } else if (selectedTradeType.has_barrier) {
                    callPayload.barrier = barrier;
                    putPayload.barrier = barrier;
                }
            }

            const registerSub = (
                reqPayload: any,
                subRef: React.MutableRefObject<string | null>,
                setter: (v: { id: string; payout: number } | null) => void,
                requestToken: number
            ) => {
                (api_base.api?.send(reqPayload) as Promise<any>)?.then((res: any) => {
                    // If another request superseded this one, discard result
                    if (requestToken !== proposalTokenRef.current) return;
                    if (res?.subscription?.id) subRef.current = res.subscription.id;
                    if (res?.proposal) {
                        const payout = parseFloat(res.proposal.payout ?? res.proposal.ask_price ?? '0');
                        setter({ id: res.proposal.id, payout });
                        setIsLoadingProposal(false);
                    }
                });
            };

            registerSub(callPayload, proposalCallSubRef, setProposalCall, token);
            if (putPayload) registerSub(putPayload, proposalPutSubRef, setProposalPut, token);
        }, 600);

        return () => {
            if (proposalTimerRef.current) clearTimeout(proposalTimerRef.current);
        };
    }, [
        selectedSymbol,
        stake,
        duration,
        durationUnit,
        currency,
        selectedTradeType,
        selectedDigit,
        barrier,
        growthRate,
        multiplier,
        takeProfit,
        stopLoss,
    ]);

    /* Click-outside for symbol dropdown */
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (symbolDropdownRef.current && !symbolDropdownRef.current.contains(e.target as Node)) {
                setShowSymbolList(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    /* ── Handlers ─────────────────────────────────────────── */
    const handleBuy = useCallback(
        (contract_type: string) => {
            if (!api_base.api || !isAuthorized) return;
            const proposal = contract_type === selectedTradeType.contract_call ? proposalCall : proposalPut;
            if (!proposal) return;
            setBuyStatus({ type: contract_type, state: 'loading' });
            api_base.api.send({ buy: proposal.id, price: parseFloat(stake) });
        },
        [isAuthorized, proposalCall, proposalPut, stake, selectedTradeType]
    );

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
        setTakeProfit('');
        setStopLoss('');
        setBarrier('+1');
        const family = tt.family ?? 'updown';
        if (family === 'turbo' || family === 'vanilla') {
            // Turbos / Vanillas — use minutes, min 15
            setDurationUnit('m');
            setDuration('15');
        } else if (tt.has_digit) {
            // Digit contracts use ticks (5-10)
            setDurationUnit('t');
            setDuration('5');
        } else if (tt.has_barrier) {
            // Barrier contracts (Higher/Lower, Touch/No Touch) — use minutes, min 15
            setDurationUnit('m');
            setDuration('15');
        } else {
            // Rise/Fall — default to 5 ticks
            setDurationUnit('t');
            setDuration('5');
        }
    };

    const handleSymbolChange = useCallback(
        (symbol: string) => {
            const sym = symbols.find(s => s.symbol === symbol);
            if (sym) handleSymbolSelect(sym);
        },
        [symbols]
    );

    const adjustStake = (delta: number) =>
        setStake(s => String(Math.max(0.35, parseFloat(s || '0') + delta).toFixed(2)));

    const durationUnitConfig = DURATION_UNITS.find(u => u.value === durationUnit) ?? DURATION_UNITS[0];
    const priceColorClass =
        priceDirection === 'up' ? 'dtrader__price--up' : priceDirection === 'down' ? 'dtrader__price--down' : '';

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

    const isDigitType = selectedTradeType.has_digit;
    const isEvenOdd = selectedTradeType.id === 'even_odd';
    const tradeFamily = selectedTradeType.family ?? 'updown';
    const isAccumulator = tradeFamily === 'accumulator';
    const isMultiplier = tradeFamily === 'multiplier';
    const isTurbo = tradeFamily === 'turbo';
    const isVanilla = tradeFamily === 'vanilla';
    const showDuration = !isEvenOdd && !isAccumulator && !isMultiplier;

    /* ── SmartChart settings ─────────────────────────────── */
    const chartSettings = {
        assetInformation: false,
        countdown: true,
        isHighestLowestMarkerEnabled: false,
        language: common?.current_language?.toLowerCase() ?? 'en',
        position: 'bottom',
        theme: ui?.is_dark_mode_on ? 'dark' : 'light',
    };

    const isConnectionOpened = !!api_base?.api;

    /* ── Render ───────────────────────────────────────────── */
    return (
        <div className='dtrader'>
            {/* ── Header: trade-type chips + account ── */}
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
                            <span className='dtrader__balance-value'>
                                {currency} {balance}
                            </span>
                        </div>
                    ) : (
                        <div className='dtrader__auth-notice'>Login to trade</div>
                    )}
                </div>
            </div>

            {/* ── Main grid: chart + params ── */}
            <div className='dtrader__body'>
                {/* Chart area */}
                <div className='dtrader__chart-area' dir='ltr'>
                    {/* Market bar (inside chart column so it spans full width) */}
                    <div className='dtrader__market-bar' ref={symbolDropdownRef}>
                        <button
                            className={`dtrader__market-selector ${showSymbolList ? 'dtrader__market-selector--open' : ''}`}
                            onClick={() => setShowSymbolList(v => !v)}
                        >
                            <div className='dtrader__market-info'>
                                <span className='dtrader__market-name'>{selectedSymbolName}</span>
                                {!isMarketOpen && (
                                    <span className='dtrader__market-badge dtrader__market-badge--closed'>
                                        CLOSED
                                    </span>
                                )}
                            </div>
                            <svg
                                className={`dtrader__market-chevron ${showSymbolList ? 'dtrader__market-chevron--up' : ''}`}
                                width='16'
                                height='16'
                                viewBox='0 0 16 16'
                                fill='none'
                            >
                                <path
                                    d='M4 6l4 4 4-4'
                                    stroke='currentColor'
                                    strokeWidth='1.5'
                                    strokeLinecap='round'
                                    strokeLinejoin='round'
                                />
                            </svg>
                        </button>

                        <div className='dtrader__spot-display'>
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

                        {/* Positions toggle */}
                        <button
                            className='dtrader__positions-toggle'
                            onClick={() => setShowPositions(v => !v)}
                        >
                            <span className='dtrader__positions-icon'>📋</span>
                            Positions {trades.length > 0 && <span className='dtrader__positions-count'>{trades.length}</span>}
                        </button>

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
                                                        <span className='dtrader__symbol-item-name'>
                                                            {sym.display_name}
                                                        </span>
                                                        <span
                                                            className={`dtrader__symbol-item-status ${sym.exchange_is_open ? '' : 'dtrader__symbol-item-status--closed'}`}
                                                        >
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

                    {/* SmartChart */}
                    <div className='dtrader__smartchart-wrap'>
                        {isConnectionOpened && selectedSymbol ? (
                            <SmartChart
                                id='dtrader-chart'
                                barriers={[]}
                                showLastDigitStats={isDigitType}
                                chartControlsWidgets={null}
                                enabledChartFooter={false}
                                chartStatusListener={() => {}}
                                toolbarWidget={() => (
                                    <ToolbarWidgets
                                        updateChartType={setChartType}
                                        updateGranularity={setGranularity}
                                        position='left'
                                        isDesktop
                                    />
                                )}
                                chartType={chartType}
                                isMobile={false}
                                enabledNavigationWidget
                                granularity={granularity}
                                requestAPI={requestAPI}
                                requestForget={() => {}}
                                requestForgetStream={requestForgetStream}
                                requestSubscribe={requestSubscribe}
                                settings={chartSettings}
                                symbol={selectedSymbol}
                                topWidgets={() => <></>}
                                isConnectionOpened={isConnectionOpened}
                                getMarketsOrder={getMarketsOrder}
                                isLive
                                leftMargin={80}
                                onExportLayout={() => {}}
                                shouldFetchTradingTimes
                            />
                        ) : (
                            <div className='dtrader__chart-placeholder'>
                                <div className='dtrader__chart-bars'>
                                    {[40, 65, 50, 75, 55, 80, 60, 70, 45, 85].map((h, i) => (
                                        <div key={i} className='dtrader__chart-bar' style={{ height: `${h}%` }} />
                                    ))}
                                </div>
                                <span className='dtrader__chart-loading'>Connecting to market…</span>
                            </div>
                        )}
                    </div>

                    {/* Positions slide-over */}
                    {showPositions && (
                        <div className='dtrader__positions-panel'>
                            <div className='dtrader__positions-header'>
                                <span className='dtrader__positions-title'>Open Positions</span>
                                <button
                                    className='dtrader__positions-close'
                                    onClick={() => setShowPositions(false)}
                                >
                                    ✕
                                </button>
                            </div>
                            {trades.length === 0 ? (
                                <div className='dtrader__positions-empty'>No trades yet</div>
                            ) : (
                                <div className='dtrader__positions-list'>
                                    {trades.map(trade => (
                                        <div
                                            key={trade.id}
                                            className={`dtrader__trade-card dtrader__trade-card--${trade.status}`}
                                        >
                                            <div className='dtrader__trade-top'>
                                                <span
                                                    className={`dtrader__trade-label ${trade.status === 'won' ? 'dtrader__trade-label--won' : trade.status === 'lost' ? 'dtrader__trade-label--lost' : ''}`}
                                                >
                                                    {trade.trade_label}
                                                </span>
                                                <span className='dtrader__trade-result'>
                                                    {trade.status === 'open' && (
                                                        <span className='dtrader__trade-open-dot' />
                                                    )}
                                                    {trade.status === 'open'
                                                        ? 'Open'
                                                        : trade.status === 'won'
                                                          ? '✓ Won'
                                                          : '✕ Lost'}
                                                </span>
                                            </div>
                                            <div className='dtrader__trade-bottom'>
                                                <span className='dtrader__trade-symbol'>{trade.symbol}</span>
                                                <span className='dtrader__trade-stake'>
                                                    {currency} {trade.stake.toFixed(2)}
                                                </span>
                                                {trade.profit !== undefined && (
                                                    <span
                                                        className={`dtrader__trade-profit ${trade.profit >= 0 ? 'dtrader__trade-profit--pos' : 'dtrader__trade-profit--neg'}`}
                                                    >
                                                        {trade.profit >= 0 ? '+' : ''}
                                                        {trade.profit.toFixed(2)}
                                                    </span>
                                                )}
                                                <span className='dtrader__trade-time'>{trade.time}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Trade parameters panel ── */}
                <div className='dtrader__params'>
                    {/* Duration — hidden for even/odd, accumulators, multipliers */}
                    {showDuration && (
                        <div className='dtrader__param-section'>
                            <div className='dtrader__param-label'>
                                {isDigitType ? 'Ticks' : 'Duration'}
                            </div>
                            <div className='dtrader__duration-wrap'>
                                {!isDigitType && (
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
                                )}
                                <div className='dtrader__duration-input-row'>
                                    <button
                                        className='dtrader__adj-btn'
                                        onClick={() =>
                                            setDuration(d =>
                                                String(Math.max(durationUnitConfig.min, parseInt(d) - 1))
                                            )
                                        }
                                    >
                                        −
                                    </button>
                                    <input
                                        type='number'
                                        className='dtrader__num-input'
                                        value={duration}
                                        min={durationUnitConfig.min}
                                        max={durationUnitConfig.max}
                                        onChange={e => setDuration(e.target.value)}
                                    />
                                    <button
                                        className='dtrader__adj-btn'
                                        onClick={() =>
                                            setDuration(d =>
                                                String(Math.min(durationUnitConfig.max, parseInt(d) + 1))
                                            )
                                        }
                                    >
                                        +
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Digit selector for digit trade types (not even/odd) */}
                    {isDigitType && !isEvenOdd && (
                        <>
                            <div className='dtrader__divider' />
                            <div className='dtrader__param-section'>
                                <div className='dtrader__param-label'>Last Digit</div>
                                <div className='dtrader__digit-grid'>
                                    {DIGIT_OPTIONS.map(d => (
                                        <button
                                            key={d}
                                            className={`dtrader__digit-btn ${selectedDigit === d ? 'dtrader__digit-btn--active' : ''}`}
                                            onClick={() => setSelectedDigit(d)}
                                        >
                                            {d}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    {/* Growth rate for Accumulators */}
                    {isAccumulator && (
                        <>
                            <div className='dtrader__divider' />
                            <div className='dtrader__param-section'>
                                <div className='dtrader__param-label'>Growth Rate</div>
                                <div className='dtrader__duration-unit-row'>
                                    {GROWTH_RATES.map(r => (
                                        <button
                                            key={r}
                                            className={`dtrader__unit-chip ${growthRate === r ? 'dtrader__unit-chip--active' : ''}`}
                                            onClick={() => setGrowthRate(r)}
                                        >
                                            {(r * 100).toFixed(0)}%
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className='dtrader__divider' />
                            <div className='dtrader__param-section'>
                                <div className='dtrader__param-label'>Take Profit ({currency}, optional)</div>
                                <input
                                    type='number'
                                    className='dtrader__num-input dtrader__num-input--stake'
                                    value={takeProfit}
                                    placeholder='No limit'
                                    onChange={e => setTakeProfit(e.target.value)}
                                />
                            </div>
                        </>
                    )}

                    {/* Multiplier selector + risk management for Multipliers */}
                    {isMultiplier && (
                        <>
                            <div className='dtrader__divider' />
                            <div className='dtrader__param-section'>
                                <div className='dtrader__param-label'>Multiplier</div>
                                <div className='dtrader__duration-unit-row'>
                                    {MULTIPLIER_OPTIONS.map(m => (
                                        <button
                                            key={m}
                                            className={`dtrader__unit-chip ${multiplier === m ? 'dtrader__unit-chip--active' : ''}`}
                                            onClick={() => setMultiplier(m)}
                                        >
                                            x{m}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className='dtrader__divider' />
                            <div className='dtrader__param-section'>
                                <div className='dtrader__param-label'>Take Profit ({currency}, optional)</div>
                                <input
                                    type='number'
                                    className='dtrader__num-input dtrader__num-input--stake'
                                    value={takeProfit}
                                    placeholder='No limit'
                                    onChange={e => setTakeProfit(e.target.value)}
                                />
                            </div>
                            <div className='dtrader__param-section'>
                                <div className='dtrader__param-label'>Stop Loss ({currency}, optional)</div>
                                <input
                                    type='number'
                                    className='dtrader__num-input dtrader__num-input--stake'
                                    value={stopLoss}
                                    placeholder='No limit'
                                    onChange={e => setStopLoss(e.target.value)}
                                />
                            </div>
                        </>
                    )}

                    {/* Barrier input for Higher/Lower, Touch/No Touch, Turbos, Vanillas */}
                    {selectedTradeType.has_barrier && !isDigitType && (
                        <>
                            <div className='dtrader__divider' />
                            <div className='dtrader__param-section'>
                                <div className='dtrader__param-label'>
                                    {isTurbo || isVanilla ? 'Strike / Barrier' : 'Barrier'}
                                </div>
                                <div className='dtrader__barrier-hint'>
                                    Relative to current spot (+/− offset)
                                </div>
                                <div className='dtrader__duration-input-row'>
                                    <button
                                        className='dtrader__adj-btn'
                                        onClick={() =>
                                            setBarrier(b => {
                                                const n = parseFloat(b);
                                                return (n - 0.5).toFixed(2);
                                            })
                                        }
                                    >
                                        −
                                    </button>
                                    <input
                                        type='text'
                                        className='dtrader__num-input'
                                        value={barrier}
                                        onChange={e => setBarrier(e.target.value)}
                                        placeholder='+1'
                                    />
                                    <button
                                        className='dtrader__adj-btn'
                                        onClick={() =>
                                            setBarrier(b => {
                                                const n = parseFloat(b);
                                                return (n + 0.5).toFixed(2);
                                            })
                                        }
                                    >
                                        +
                                    </button>
                                </div>
                                <div className='dtrader__quick-stakes' style={{ marginTop: '0.8rem' }}>
                                    {['-1', '+0.5', '+1', '+2'].map(v => (
                                        <button
                                            key={v}
                                            className='dtrader__quick-stake-btn'
                                            onClick={() => setBarrier(v)}
                                        >
                                            {v}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    <div className='dtrader__divider' />

                    {/* Stake */}
                    <div className='dtrader__param-section'>
                        <div className='dtrader__param-label'>Stake ({currency})</div>
                        <div className='dtrader__stake-row'>
                            <button className='dtrader__adj-btn' onClick={() => adjustStake(-0.5)}>
                                −
                            </button>
                            <input
                                type='number'
                                className='dtrader__num-input dtrader__num-input--stake'
                                value={stake}
                                min={0.35}
                                step={0.5}
                                onChange={e => setStake(e.target.value)}
                            />
                            <button className='dtrader__adj-btn' onClick={() => adjustStake(0.5)}>
                                +
                            </button>
                        </div>
                        <div className='dtrader__quick-stakes'>
                            {[1, 5, 10, 25].map(v => (
                                <button
                                    key={v}
                                    className='dtrader__quick-stake-btn'
                                    onClick={() => setStake(String(v))}
                                >
                                    {v}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className='dtrader__divider' />

                    {/* Payout preview */}
                    <div className='dtrader__param-section'>
                        <div className='dtrader__param-label'>{isAccumulator || isMultiplier ? 'Stake Value' : 'Payout'}</div>
                        <div className='dtrader__payout-row'>
                            <div className={`dtrader__payout-item dtrader__payout-item--${selectedTradeType.call_color}`}>
                                <span className='dtrader__payout-dir'>{selectedTradeType.call_label}</span>
                                <span className='dtrader__payout-val'>
                                    {isLoadingProposal ? (
                                        <span className='dtrader__payout-loading'>…</span>
                                    ) : proposalCall ? (
                                        `${currency} ${proposalCall.payout.toFixed(2)}`
                                    ) : (
                                        '--'
                                    )}
                                </span>
                            </div>
                            {!selectedTradeType.single_sided && (
                                <div className={`dtrader__payout-item dtrader__payout-item--${selectedTradeType.put_color}`}>
                                    <span className='dtrader__payout-dir'>{selectedTradeType.put_label}</span>
                                    <span className='dtrader__payout-val'>
                                        {isLoadingProposal ? (
                                            <span className='dtrader__payout-loading'>…</span>
                                        ) : proposalPut ? (
                                            `${currency} ${proposalPut.payout.toFixed(2)}`
                                        ) : (
                                            '--'
                                        )}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className='dtrader__spacer' />

                    {/* Status / login hint */}
                    {buyStatus && buyStatus.state !== 'loading' && (
                        <div className={`dtrader__toast dtrader__toast--${buyStatus.state}`}>
                            {buyStatus.state === 'success' ? '✓ ' : '✕ '}
                            {buyStatus.message}
                        </div>
                    )}
                    {!isAuthorized && <div className='dtrader__login-hint'>Login to place trades</div>}

                    {/* Purchase buttons */}
                    <div className='dtrader__purchase-btns'>
                        <button
                            className={`dtrader__purchase-btn dtrader__purchase-btn--${selectedTradeType.call_color} ${!proposalCall || !isAuthorized || (buyStatus?.type === selectedTradeType.contract_call && buyStatus.state === 'loading') ? 'dtrader__purchase-btn--disabled' : ''}`}
                            onClick={() => handleBuy(selectedTradeType.contract_call)}
                            disabled={
                                !proposalCall ||
                                !isAuthorized ||
                                (buyStatus?.type === selectedTradeType.contract_call &&
                                    buyStatus.state === 'loading')
                            }
                        >
                            <div className='dtrader__purchase-btn-inner'>
                                <span className='dtrader__purchase-arrow'>▲</span>
                                <div className='dtrader__purchase-text'>
                                    <span className='dtrader__purchase-action'>
                                        {selectedTradeType.call_label}
                                    </span>
                                    {proposalCall && (
                                        <span className='dtrader__purchase-payout'>
                                            {currency} {proposalCall.payout.toFixed(2)}
                                        </span>
                                    )}
                                </div>
                                {buyStatus?.type === selectedTradeType.contract_call &&
                                    buyStatus.state === 'loading' && (
                                        <span className='dtrader__purchase-spinner' />
                                    )}
                            </div>
                        </button>
                        {!selectedTradeType.single_sided && (
                            <button
                                className={`dtrader__purchase-btn dtrader__purchase-btn--${selectedTradeType.put_color} ${!proposalPut || !isAuthorized || (buyStatus?.type === selectedTradeType.contract_put && buyStatus.state === 'loading') ? 'dtrader__purchase-btn--disabled' : ''}`}
                                onClick={() => handleBuy(selectedTradeType.contract_put)}
                                disabled={
                                    !proposalPut ||
                                    !isAuthorized ||
                                    (buyStatus?.type === selectedTradeType.contract_put &&
                                        buyStatus.state === 'loading')
                                }
                            >
                                <div className='dtrader__purchase-btn-inner'>
                                    <span className='dtrader__purchase-arrow'>▼</span>
                                    <div className='dtrader__purchase-text'>
                                        <span className='dtrader__purchase-action'>
                                            {selectedTradeType.put_label}
                                        </span>
                                        {proposalPut && (
                                            <span className='dtrader__purchase-payout'>
                                                {currency} {proposalPut.payout.toFixed(2)}
                                            </span>
                                        )}
                                    </div>
                                    {buyStatus?.type === selectedTradeType.contract_put &&
                                        buyStatus.state === 'loading' && (
                                            <span className='dtrader__purchase-spinner' />
                                        )}
                                </div>
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});

export default DTrader;
