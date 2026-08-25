import PublicLanding from '@/components/public/PublicLanding.vue'
import GuestDemo from '@/components/public/GuestDemo.vue'
import OAuthCallback from '@/components/OAuthCallback.vue'

export default [
  {
    path: '/oauth2/callback',
    name: 'OAuthCallback',
    component: OAuthCallback,
    meta: {
      title: 'app.task_list',
      showInMenu: false
    }
  },
  {
    path: '/',
    name: 'PublicLanding',
    component: PublicLanding,
    meta: {
      showInMenu: false,
      publicEntry: true
    }
  },
  {
    path: '/demo',
    name: 'GuestDemo',
    component: GuestDemo,
    meta: {
      showInMenu: false,
      publicEntry: true
    }
  },
  {
    path: '/chat',
    name: 'Chat',
    component: () => import('@/components/chat/Chat'),
    meta: {
      title: 'chat.title',
      icon: 'chat-processing-outline',
      iconColor: '#2563eb',
      showInMenu: true,
      menuOrder: 1
    }
  },
  {
    path: '/juyiting',
    name: 'JuyiHall',
    component: () => import('@/components/world/JuyiHallEntry.vue'),
    meta: {
      title: 'juyiting.title',
      icon: 'account-circle',
      iconColor: '#8b3a1f',
      showInMenu: true,
      menuOrder: 0
    }
  },
  {
    path: '/task',
    name: 'TaskIndex',
    component: () => import('@/components/TaskIndex'),
    meta: {
      title: 'app.title',
      icon: 'calendar-month-outline',
      iconColor: '#0f766e',
      showInMenu: true,
      menuOrder: 3
    }
  },
  {
    path: '/list',
    name: 'TaskList',
    component: () => import('@/components/TaskList'),
    meta: {
      title: 'app.task_list',
      showInMenu: false
    }
  },
  {
    path: '/history',
    name: 'TaskHistory',
    component: () => import('@/components/TaskHistory'),
    meta: {
      title: 'app.task_history',
      showInMenu: false
    }
  },
  {
    path: '/add',
    name: 'TaskAdd',
    component: () => import('@/components/TaskAdd'),
    meta: {
      title: 'app.task_add',
      showInMenu: false
    }
  },
  {
    path: '/gift',
    name: 'GiftList',
    component: () => import('@/components/GiftList'),
    meta: {
      title: 'gift.title',
      icon: 'shopping-outline',
      iconColor: '#be185d',
      showInMenu: true,
      menuOrder: 4
    }
  },
  {
    path: '/pay',
    name: 'GiftPay',
    component: () => import('@/components/GiftPay'),
    meta: {
      title: 'gift.title',
      showInMenu: false
    }
  },
  {
    path: '/order/list',
    name: 'OrderList',
    component: () => import('@/components/OrderList'),
    meta: {
      title: 'gift.order_list',
      showInMenu: false
    }
  },
  {
    path: '/profile',
    name: 'UserProfile',
    component: () => import('@/components/UserProfile'),
    meta: {
      title: '个人中心',
      showInMenu: true,
      menuOrder: 0,
      icon: 'account-circle',
      iconColor: '#4f46e5'
    }
  },
  {
    path: '/messages',
    name: 'MessageCenter',
    component: () => import('@/components/MessageCenter'),
    meta: {
      title: 'message.title',
      showInMenu: true,
      menuOrder: 5,
      icon: 'bell'
    }
  },
  {
    path: '/help',
    name: 'HelpCenter',
    component: () => import('@/components/HelpCenter'),
    meta: {
      title: 'help.title',
      showInMenu: true,
      menuOrder: 6,
      icon: 'help-circle'
    }
  },
  {
    path: '/vote',
    name: 'VoteTick',
    component: () => import('@/components/VoteTick'),
    meta: {
      title: 'vote.title',
      icon: 'check-circle-outline',
      iconColor: '#7c3aed',
      showInMenu: true,
      menuOrder: 7
    }
  },
  {
    path: '/phrase',
    name: 'Phrase',
    component: () => import('@/components/Phrase'),
    meta: {
      title: 'phrase.title',
      icon: 'message-text-outline',
      iconColor: '#b45309',
      showInMenu: true,
      menuOrder: 8
    }
  },
  {
    path: '/dwz',
    name: 'ShortLink',
    component: () => import('@/components/ShortLink'),
    meta: {
      title: 'dwz.title',
      icon: 'share-outline',
      iconColor: '#475569',
      showInMenu: true,
      menuOrder: 9
    }
  },
  {
    path: '/wx/mp',
    name: 'WxMpManager',
    component: () => import('@/components/WxMpManager'),
    meta: {
      title: '公众号管理',
      icon: 'wechat',
      iconColor: '#16875e',
      showInMenu: true,
      menuOrder: 10
    }
  },
  {
    path: '/hello',
    name: 'HellowList',
    component: () => import('@/components/HelloWorld')
  }
]
