import { useApiStore } from '@/stores/api'
import { log } from '@/utils/logger'

export default [
  {
    path: '/oauth2/callback',
    name: 'OAuthCallback',
    component: {
      async beforeRouteEnter (to, from, next) {
        try {
          const code = to.query.code
          if (!code) throw new Error('No authorization code provided')
          const apiStore = useApiStore()
          await apiStore.exchangeCodeForToken(code)
          await apiStore.getUserInfo()
          next(to.query.state || '/')
        } catch (error) {
          log.error('OAuth callback error:', error)
          next('/')
        }
      },
      render: () => null
    },
    meta: {
      title: 'app.task_list',
      showInMenu: false
    }
  },
  {
    path: '/',
    redirect: '/juyiting',
    meta: {
      showInMenu: false
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
    component: () => import('@/components/world/JuyiHall'),
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
    path: '/hello',
    name: 'HellowList',
    component: () => import('@/components/HelloWorld')
  }
]
