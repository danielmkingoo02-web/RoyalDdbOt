import { useState } from 'react';
import './autotrades.scss';

interface AutoBot {
    id: string;
    name: string;
    icon: string;
    file: string;
}

/* Register autotrade bots here as more are added */
const AUTO_BOTS: AutoBot[] = [
    {
        id: 'differs-recovery-o3u6',
        name: 'Differs + Recovery O3U6',
        icon: '🎯',
        file: '/autotrade-bots/differs-recovery-o3u6.html',
    },
];

const Autotrades = () => {
    const [selectedBotId, setSelectedBotId] = useState<string | null>(AUTO_BOTS[0]?.id ?? null);
    const selectedBot = AUTO_BOTS.find(b => b.id === selectedBotId) ?? null;

    return (
        <div className='autotrades'>
            <div className='autotrades__sidebar'>
                <div className='autotrades__sidebar-title'>Autotrade Bots</div>
                {AUTO_BOTS.map(bot => (
                    <button
                        key={bot.id}
                        className={`autotrades__bot-btn ${selectedBotId === bot.id ? 'autotrades__bot-btn--active' : ''}`}
                        onClick={() => setSelectedBotId(bot.id)}
                    >
                        <span className='autotrades__bot-icon'>{bot.icon}</span>
                        <span>{bot.name}</span>
                    </button>
                ))}
                <div className='autotrades__bot-placeholder'>More bots coming soon</div>
            </div>
            <div className='autotrades__main'>
                {selectedBot ? (
                    <iframe
                        key={selectedBot.id}
                        className='autotrades__iframe'
                        src={selectedBot.file}
                        title={selectedBot.name}
                        allow='clipboard-write'
                        sandbox='allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin'
                    />
                ) : (
                    <div className='autotrades__empty'>
                        <span>🤖</span>
                        <span>Select a bot from the list</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Autotrades;
